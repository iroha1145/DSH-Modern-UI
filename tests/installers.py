#!/usr/bin/env python3
"""Offline subprocess fixtures for the production Bash installer and launcher."""
import base64, hashlib, json, os, pathlib, shutil, subprocess, tarfile, tempfile, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
class Installer(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.base=pathlib.Path(self.tmp.name)
  self.repo=self.base/'repo'; shutil.copytree(ROOT/'scripts',self.repo/'scripts'); self.commit='a'*40; self.node_version=json.loads((ROOT/'dsh-ui.json').read_text())['node']['runtime']
  self.install=self.base/'install'; self.home=self.base/'user'; self.home.mkdir()
  self.bin=self.base/'bin'; self.bin.mkdir(); self.download=self.base/'download'; self.download.mkdir()
  patch=b'diff --git a/example b/example\n--- a/example\n+++ b/example\n@@ -1 +1 @@\n-old\n+new\n'
  (self.repo/'patch').write_bytes(patch)
  (self.repo/'dsh-ui.json').write_text(json.dumps({'commit':self.commit,'tarball':'fixture/source.tar.gz','file':'patch','sha256':hashlib.sha256(patch).hexdigest(),'runtime':self.node_version,'pnpm':'11.28.5','profile':'web'},indent=2))
  source=self.base/'source'; source.mkdir(); (source/'example').write_text('old\n')
  self.archive(source,self.download/'source.tar.gz')
  manifest=json.loads((self.repo/'dsh-ui.json').read_text())
  manifest['tarballSha256']=hashlib.sha256((self.download/'source.tar.gz').read_bytes()).hexdigest()
  (self.repo/'dsh-ui.json').write_text(json.dumps(manifest,indent=2))
  self.node=self.base/'node'; (self.node/'bin').mkdir(parents=True); (self.node/'include/node').mkdir(parents=True); (self.node/'lib/node_modules/npm/bin').mkdir(parents=True)
  for name in ['node.h','node_api.h','node_api_types.h','common.gypi']: (self.node/'include/node'/name).write_text('fixture')
  (self.node/'lib/node_modules/npm/bin/npm-cli.js').write_text('fixture')
  self.executable(self.node/'bin/node','''#!/bin/bash
if [ "$1" = -p ]; then
 case "$2" in process.versions.node) echo $FIXTURE_NODE_VERSION;; *) echo file:///fixture-loader;; esac
elif [ "$1" = -v ]; then echo v$FIXTURE_NODE_VERSION
elif [[ "$1" == */npm-cli.js ]]; then echo 10.0.0
else printf '%s\\n' "$@" > "$CAPTURE"; fi
''')
  self.executable(self.node/'bin/npm','''#!/bin/bash
if [ "$1" = --version ]; then echo 10.0.0; exit; fi
mkdir -p "$3/node_modules/.bin"
cp "$FAKE_PNPM" "$3/node_modules/.bin/pnpm"
''')
  self.executable(self.bin/'fake-pnpm','''#!/bin/bash
if [ "$1" = -v ]; then echo 11.28.5; exit; fi
if [ "$1" = install ] && [ "$FAIL_INSTALL" = yes ]; then exit 23; fi
if [ "$1" = run ] && [ "$FAIL_BUILD" = yes ]; then exit 24; fi
if [ "$1" = run ]; then
 test ! -e .git && test "$DSH_CLIENT_COMMIT_HASH" = "$EXPECTED_COMMIT" || exit 25
 printf '%s' "$DSH_CLIENT_COMMIT_HASH" > "$CAPTURE_BUILD_METADATA"
fi
''')
  system=subprocess.check_output(['uname','-s'],text=True).strip().lower(); arch=subprocess.check_output(['uname','-m'],text=True).strip(); arch='arm64' if arch in ('arm64','aarch64') else 'x64'
  self.node_name=f'node-v{self.node_version}-{system}-{arch}.tar.gz'; self.archive(self.node,self.download/self.node_name)
  self.refresh_sums()
  self.executable(self.bin/'curl','''#!/bin/bash
out=''
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; --retry) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done
file="$DOWNLOAD/${url##*/}"
if [ -n "$out" ]; then cp "$file" "$out"; else cat "$file"; fi
''')
  self.env={**os.environ,'FIXTURE_NODE_VERSION':self.node_version,'HOME':str(self.home),'DSH_HOME':str(self.base/'official'),'PATH':str(self.bin)+':'+os.environ['PATH'],'DOWNLOAD':str(self.download),'FAKE_PNPM':str(self.bin/'fake-pnpm'),'CAPTURE':str(self.base/'argv'),'DSH_UI_NODE_MIRROR':'fixture','EXPECTED_COMMIT':self.commit,'CAPTURE_BUILD_METADATA':str(self.base/'build-commit')}
 def tearDown(self): self.tmp.cleanup()
 def executable(self,p,s): p.write_text(s); p.chmod(0o755)
 def archive(self,p,d):
  with tarfile.open(d,'w:gz') as t: t.add(p,arcname=p.name)
 def refresh_sums(self): (self.download/'SHASUMS256.txt').write_text(hashlib.sha256((self.download/self.node_name).read_bytes()).hexdigest()+'  '+self.node_name+'\n')
 def run_install(self,*args,ok=True,**env):
  p=subprocess.run(['bash',str(self.repo/'scripts/install.sh'),'--dir',str(self.install),'--skip-plugins',*args],env={**self.env,**env},text=True,capture_output=True)
  self.assertEqual(p.returncode==0,ok,p.stdout+p.stderr); return p
 def gitless_path(self,unusable=False):
  isolated=self.base/('unusable-git' if unusable else 'missing-git'); isolated.mkdir()
  (isolated/'bash').symlink_to(shutil.which('bash'))
  (isolated/'cat').symlink_to(shutil.which('cat'))
  self.executable(isolated/'curl','#!/bin/bash\nprintf called > "$DOWNLOAD_CALLED"\nexit 99\n')
  if unusable: self.executable(isolated/'git','#!/bin/bash\nexit 77\n')
  return str(isolated)
 def snapshot(self,path):
  return {str(p.relative_to(path)):(p.lstat().st_mode,p.read_bytes() if p.is_file() else None) for p in path.rglob('*')}
 def test_missing_or_unusable_git_fails_before_installation_writes(self):
  for unusable in [False,True]:
   with self.subTest(unusable=unusable):
    path=self.gitless_path(unusable)
    marker=self.base/'download-called'
    p=self.run_install('--prepare-only',ok=False,PATH=path,DOWNLOAD_CALLED=str(marker))
    self.assertIn('需要可用的 Git',p.stderr)
    self.assertIn('二进制',p.stderr)
    self.assertFalse(self.install.exists())
    self.assertFalse(marker.exists())
    self.assertFalse((self.base/'official').exists())
 def test_missing_or_unusable_git_preserves_existing_data_runtime_and_settings(self):
  self.run_install()
  (self.install/'data/session.json').write_text('{"fixture":"keep"}')
  before=self.snapshot(self.install)
  for unusable in [False,True]:
   with self.subTest(unusable=unusable):
    marker=self.base/'download-called'
    self.run_install('--force','--home',str(self.install/'data'),'--profile','changed',ok=False,PATH=self.gitless_path(unusable),DOWNLOAD_CALLED=str(marker))
    self.assertEqual(self.snapshot(self.install),before)
    self.assertFalse(marker.exists())
 def test_help_without_git_or_repository_does_not_download(self):
  standalone=self.base/'standalone'; standalone.mkdir()
  script=standalone/'install.sh'; shutil.copyfile(self.repo/'scripts/install.sh',script)
  marker=self.base/'download-called'
  for flag in ['--help','-h']:
   p=subprocess.run([shutil.which('bash'),str(script),flag],env={**self.env,'PATH':self.gitless_path(flag=='-h'),'DOWNLOAD_CALLED':str(marker)},text=True,capture_output=True)
   self.assertEqual(p.returncode,0,p.stdout+p.stderr)
   self.assertIn('用法',p.stdout)
   self.assertFalse(self.install.exists())
   self.assertFalse(marker.exists())
 def test_bootstrap_preserves_arguments_and_accepts_no_arguments(self):
  standalone=self.base/'standalone'; standalone.mkdir()
  script=standalone/'install.sh'; shutil.copyfile(self.repo/'scripts/install.sh',script)
  self.archive(self.repo,self.download/'repo.tar.gz')
  data=self.base/'custom # data'
  for args,target in [(['--dir',str(self.install),'--home',str(data),'--profile','research','--prepare-only'],self.install),([],self.home/'.dsh-ui')]:
   with self.subTest(args=args):
    p=subprocess.run(['/bin/bash',str(script),*args],env={**self.env,'DSH_UI_REPO_URL':'fixture/repo.tar.gz'},text=True,capture_output=True)
    self.assertEqual(p.returncode,0,p.stdout+p.stderr)
    self.assertEqual((target/'dsh/example').read_text(),'new\n')
  self.assertIn('research',(self.install/'install.conf').read_text())
  self.assertTrue(data.is_dir())
 def test_git_applies_binary_png_deletion(self):
  source=self.base/'source'; binary=source/'running-whale.png'
  data=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=')
  binary.write_bytes(data)
  subprocess.run(['git','init','-q',str(source)],check=True)
  subprocess.run(['git','-C',str(source),'add','running-whale.png'],check=True)
  binary.unlink()
  deletion=subprocess.check_output(['git','-C',str(source),'-c','core.autocrlf=false','diff','--binary','--','running-whale.png'])
  self.assertIn(b'GIT binary patch',deletion)
  self.assertIn(b'literal 0',deletion)
  binary.write_bytes(data); shutil.rmtree(source/'.git')
  self.archive(source,self.download/'source.tar.gz')
  patch=(self.repo/'patch').read_bytes()+deletion; (self.repo/'patch').write_bytes(patch)
  manifest=json.loads((self.repo/'dsh-ui.json').read_text())
  manifest['sha256']=hashlib.sha256(patch).hexdigest()
  manifest['tarballSha256']=hashlib.sha256((self.download/'source.tar.gz').read_bytes()).hexdigest()
  (self.repo/'dsh-ui.json').write_text(json.dumps(manifest,indent=2))
  self.run_install('--prepare-only')
  self.assertFalse((self.install/'dsh/running-whale.png').exists())
  self.assertEqual((self.install/'dsh/example').read_text(),'new\n')
 def test_resume_and_explicit_override(self):
  data=self.base/'custom data'; self.run_install('--home',str(data),'--profile','research','--prepare-only')
  self.assertFalse((self.install/'launch.conf').exists())
  self.run_install(ok=False,FAIL_INSTALL='yes'); self.run_install(ok=False,FAIL_BUILD='yes'); self.run_install()
  self.assertIn('research',(self.install/'launch.conf').read_text()); self.assertIn('custom\\ data',(self.install/'launch.conf').read_text())
  self.run_install('--profile','other','--prepare-only'); self.assertIn('research',(self.install/'launch.conf').read_text())
  self.run_install(); self.assertIn('other',(self.install/'launch.conf').read_text())
  self.run_install('--force','--profile','pending',ok=False,FAIL_BUILD='yes'); self.assertIn('other',(self.install/'launch.conf').read_text())
  self.run_install(); self.assertIn('pending',(self.install/'launch.conf').read_text())
 def test_rejects_install_directory_as_data_home(self):
  self.run_install('--home',str(self.install),ok=False)
  self.assertFalse((self.install/'install.conf').exists())
 def test_reserved_homes_rejected_before_any_creation(self):
  for name in ['dsh','dsh/new/session','runtime','runtime/node/new','data-backups/new','overlays/new','dsh.old-next/new','install.conf/new']:
   with self.subTest(name=name):
    self.run_install('--home',str(self.install/name),'--prepare-only',ok=False)
    self.assertFalse(self.install.exists())
 def test_aliases_and_saved_unsafe_home_preserve_active_install(self):
  self.run_install()
  session=self.install/'data/session'; session.write_bytes(b'active\x00session')
  alias=self.base/'alias'; alias.symlink_to(self.install, target_is_directory=True)
  ancestor=self.base/'ancestor'; ancestor.symlink_to(self.base, target_is_directory=True)
  for target in [alias,ancestor,alias/'dsh/new',alias/'runtime/node/new',alias/'data-backups/new']:
   before=self.snapshot(self.install)
   self.run_install('--force','--home',str(target),ok=False)
   self.assertEqual(self.snapshot(self.install),before)
  for managed in ['dsh','runtime','data-backups']:
   path=self.install/managed
   if not path.exists(): path.mkdir()
   external=self.base/('alias-'+managed); external.symlink_to(path,target_is_directory=True)
   before=self.snapshot(self.install)
   self.run_install('--home',str(external/'new'),ok=False)
   self.assertEqual(self.snapshot(self.install),before)
  for conf in ['install.conf','launch.conf']:
   (self.install/'install.conf').unlink(missing_ok=True)
   (self.install/conf).write_text('DSH_UI_HOME='+str(alias/'dsh/new')+'\nDSH_UI_PROFILE=web\n')
   before=self.snapshot(self.install); self.run_install('--prepare-only',ok=False)
   self.assertEqual(self.snapshot(self.install),before)
  self.assertEqual(session.read_bytes(),b'active\x00session')
 def test_managed_symlink_target_outside_install_is_rejected(self):
  self.install.mkdir(); outside=self.base/'outside';outside.mkdir()
  (outside/'session').write_bytes(b'keep')
  (self.install/'runtime').symlink_to(outside,target_is_directory=True)
  before=self.snapshot(self.install)
  self.run_install('--home',str(outside/'new'),ok=False)
  self.assertEqual(self.snapshot(self.install),before)
  self.assertFalse((outside/'new').exists())
 def test_default_data_symlink_to_source_rejected(self):
  self.install.mkdir(); (self.install/'dsh').mkdir()
  (self.install/'data').symlink_to(self.install/'dsh',target_is_directory=True)
  before=self.snapshot(self.install);self.run_install('--prepare-only',ok=False)
  self.assertEqual(self.snapshot(self.install),before)
 def test_case_alias_cannot_replace_active_source_home(self):
  self.run_install('--prepare-only')
  source_home=self.install/'dsh/session-data'; source_home.mkdir()
  session=source_home/'active-session';session.write_bytes(b'original-active-session')
  mixed=self.install.parent/'INSTALL'/'DSH'/'session-data'
  if not mixed.exists() or not mixed.samefile(source_home):
   self.skipTest('This filesystem is case-sensitive; macOS CI exercises case aliases')
  before=self.snapshot(self.install)
  self.run_install('--home',str(mixed),'--force','--prepare-only',ok=False)
  self.assertEqual(session.read_bytes(),b'original-active-session')
  self.assertEqual(self.snapshot(self.install),before)
  self.run_install('--home',str(mixed.parent/'missing-leaf'),'--force','--prepare-only',ok=False)
  self.assertEqual(self.snapshot(self.install),before)
  self.run_install('--home',str(self.install.parent/'INSTALL'),'--prepare-only',ok=False)
  self.assertEqual(self.snapshot(self.install),before)
 def test_case_alias_rejected_before_fresh_install_creation(self):
  alias=self.base/'USER'
  if not alias.exists() or not alias.samefile(self.home):
   self.skipTest('Case-sensitive filesystem')
  for home in [self.base/'INSTALL', self.base/'INSTALL/DSH/user-data']:
   self.run_install('--home',str(home),'--prepare-only',ok=False)
   self.assertFalse(self.install.exists())
   self.assertFalse(home.exists())
 def test_empty_common_ancestor_case_probe_is_cleaned(self):
  if not (self.base/'USER').exists(): self.skipTest('Case-sensitive filesystem')
  empty=self.base/'empty';empty.mkdir(); self.install=empty/'install'
  self.run_install('--home',str(empty/'INSTALL/DSH/user-data'),'--prepare-only',ok=False)
  self.assertEqual(list(empty.iterdir()),[])
 def test_failed_case_probe_fails_closed_without_candidate_writes(self):
  empty=self.base/'empty';empty.mkdir(); self.install=empty/'install'
  self.executable(self.bin/'mktemp','#!/bin/bash\nexit 77\n')
  self.run_install('--home',str(empty/'INSTALL/DSH/user-data'),'--prepare-only',ok=False)
  self.assertEqual(list(empty.iterdir()),[])
 def test_unicode_cold_alias_is_checked_by_filesystem_identity(self):
  witness=self.base/'é';witness.mkdir()
  if not (self.base/'É').exists(): self.skipTest('Filesystem treats these Unicode names as distinct')
  empty=self.base/'unicode-empty';empty.mkdir();self.install=empty/'install-é'
  for home in [empty/'INSTALL-É/DSH/new',empty/'install-e\u0301/DSH/new',empty/'INSTALL-É']:
   self.run_install('--home',str(home),'--prepare-only',ok=False)
   self.assertEqual(list(empty.iterdir()),[])
 def test_unicode_probe_failure_cleans_allocated_directory(self):
  empty=self.base/'unicode-empty';empty.mkdir();self.install=empty/'install-é'
  self.executable(self.bin/'mkdir','#!/bin/bash\nexit 77\n')
  self.run_install('--home',str(empty/'INSTALL-É/DSH/new'),'--prepare-only',ok=False)
  self.assertEqual(list(empty.iterdir()),[])
 def test_unicode_independent_external_home_keeps_requested_spelling(self):
  data=self.base/'独立数据'
  self.run_install('--home',str(data),'--prepare-only')
  self.assertTrue(data.is_dir())
  self.assertFalse(list(self.base.glob('.dsh-path-*')))
 def test_unicode_external_home_below_readonly_common_ancestor_needs_no_probe(self):
  common=self.base/'shared';common.mkdir()
  install_parent=common/'a';install_parent.mkdir()
  data_parent=common/'b';data_parent.mkdir()
  self.install=install_parent/'install';data=data_parent/'独立数据'
  real_mktemp=shutil.which('mktemp')
  self.executable(self.bin/'mktemp', '#!/bin/bash\ncase "$*" in *.dsh-path-*|*.dsh-case-*) printf called > "$PROBE_MARKER"; exit 77;; esac\nexec '+real_mktemp+' "$@"\n')
  marker=self.base/'probe-called'
  common.chmod(0o555)
  try:
   self.run_install('--home',str(data),'--prepare-only',PROBE_MARKER=str(marker))
   self.assertTrue(data.is_dir())
   self.assertFalse(marker.exists())
   self.assertEqual(sorted(p.name for p in common.iterdir()),['a','b'])
  finally: common.chmod(0o755)
 def test_case_sensitive_external_directories_remain_distinct(self):
  managed=self.base/'Separate';managed.mkdir()
  data=self.base/'separate'
  if data.exists(): self.skipTest('Case-insensitive filesystem')
  data.mkdir();(data/'session').write_bytes(b'keep-distinct')
  self.install.mkdir();(self.install/'dsh.old-fixture').symlink_to(managed,target_is_directory=True)
  self.run_install('--home',str(data),'--prepare-only')
  self.assertEqual((data/'session').read_bytes(),b'keep-distinct')
 def test_missing_leaf_through_symlink_and_physical_install_root(self):
  target=self.base/'safe-external'; alias=self.base/'safe-alias';alias.symlink_to(target,target_is_directory=True)
  self.run_install('--home',str(alias/'new'),'--prepare-only')
  self.assertTrue((target/'new').is_dir())
  ancestor=self.base/'parent-alias';ancestor.symlink_to(self.base,target_is_directory=True)
  self.install=ancestor/'install'
  self.run_install('--home',str(target/'new'),'--prepare-only')
  before=self.snapshot(self.install)
  self.run_install('--home',str(ancestor/'install/dsh/new'),'--prepare-only',ok=False)
  self.assertEqual(self.snapshot(self.install),before)
 def test_safe_home_bytes_survive_failed_build_force_and_retry(self):
  for data in [self.install/'data', self.base/'external']:
   data.mkdir(parents=True,exist_ok=True); session=data/'session';session.write_bytes(b'active\x00original')
   self.run_install('--home',str(data),'--force',ok=False,FAIL_BUILD='yes')
   self.assertEqual(session.read_bytes(),b'active\x00original')
   self.run_install();self.run_install('--force','--prepare-only');self.run_install()
   self.assertEqual(session.read_bytes(),b'active\x00original')
 def test_repeated_force_with_frozen_time_preserves_each_source_tree(self):
  self.executable(self.bin/'date','#!/bin/bash\necho 20000101000000\n')
  self.run_install()
  data=self.install/'data/session';data.write_bytes(b'active-original')
  legacy=self.install/'dsh.old-20000101000000';legacy.mkdir();(legacy/'keep').write_bytes(b'old-backup')
  for revision in range(3):
   source=self.install/'dsh'
   (source/'revision').write_text(str(revision))
   (source/'nested').mkdir();(source/'nested/content').write_bytes(b'complete-source')
   self.run_install('--force')
   self.assertEqual((source/'example').read_text(),'new\n')
   self.assertFalse((source/'revision').exists())
   self.assertEqual(data.read_bytes(),b'active-original')
  backups=[p for p in self.install.glob('dsh.old-*') if p!=legacy]
  self.assertEqual(len(backups),3)
  self.assertEqual(sorted((p/'revision').read_text() for p in backups),['0','1','2'])
  for backup in backups:
   self.assertEqual((backup/'nested/content').read_bytes(),b'complete-source')
   self.assertEqual((backup/'example').read_text(),'new\n')
   self.assertFalse((backup/'dsh').exists())
  self.assertEqual((legacy/'keep').read_bytes(),b'old-backup')
  self.assertEqual(list(legacy.iterdir()),[legacy/'keep'])
 def test_recorded_home_has_exact_physical_path_without_double_root(self):
  self.run_install()
  expected=str((self.install/'data').resolve())
  self.assertFalse(expected.startswith('//'))
  for config in ['install.conf','launch.conf']:
   actual=subprocess.check_output(['bash','-c','source "$1"; printf "%s" "$DSH_UI_HOME"','fixture',str(self.install/config)],text=True)
   self.assertEqual(actual,expected)
 def test_archive_build_uses_pinned_commit(self):
  self.run_install(DSH_CLIENT_COMMIT_HASH='b'*40)
  self.assertEqual((self.base/'build-commit').read_text(),self.commit)
 def test_default_isolation_backup_and_argv(self):
  self.run_install(); self.assertFalse((self.base/'official').exists()); self.assertIn(str(self.install/'data'),(self.install/'launch.conf').read_text())
  data=self.base/'shared'; data.mkdir(); (data/'session').write_text('old')
  self.run_install('--home',str(data)); backups=list((self.install/'data-backups').glob('*/data.tar.gz')); self.assertEqual(len(backups),1)
  with tarfile.open(backups[0]) as t: self.assertEqual(t.extractfile('./session').read(),b'old')
  # Exercise the old overlay trigger: an installed context plugin and a leftover overlay.
  plugin=data/'profiles/web/node_modules/dsh-context'; plugin.mkdir(parents=True)
  overlay=self.install/'overlays'; overlay.mkdir(); (overlay/'context-fleet-tab.yml').write_text('- id: dsh-context\n  config: { fleetTab: hide }\n')
  config=data/'profiles/web/cordis.patch.yml'; original='- id: dsh-context\n  config: { promptPrefix: Keep-prefix, promptSuffix: Keep-suffix, maxKeptTurns: 25, overviewAutoSteps: 0 }\n'; config.write_text(original)
  for args in [[],['web'],['--profile','web'],['--profile=web'],['plugin','list'],['web','--dump-config'],['web','--dump-default-config']]:
   subprocess.run([str(self.install/'dsh-ui'),*args],env=self.env,check=True)
   self.assertEqual((self.base/'argv').read_text().splitlines()[3:],args or ['web'])
   self.assertEqual(config.read_text(),original)
 def test_partial_runtime_recovery_and_failed_download_preserves_old(self):
  self.run_install('--prepare-only'); node=self.install/'runtime/node'
  for missing in ['bin/npm','lib/node_modules/npm/bin/npm-cli.js','include/node/node.h','include/node/node_api.h','.complete']:
   (node/missing).unlink(); self.run_install('--prepare-only'); self.assertTrue((node/missing).exists())
  (node/'.complete').unlink(); (self.download/self.node_name).write_bytes(b'broken')
  self.run_install('--prepare-only',ok=False); self.assertTrue((node/'bin/node').exists())
  self.refresh_sums(); self.run_install('--prepare-only',ok=False); self.assertTrue((node/'bin/node').exists())
  self.archive(self.node,self.download/self.node_name); self.refresh_sums(); self.run_install('--prepare-only')
  node.rename(self.install/'runtime/interrupted'); shutil.rmtree(self.install/'runtime/node.previous'); (self.install/'runtime/interrupted').rename(self.install/'runtime/node.previous')
  self.run_install('--prepare-only'); self.assertTrue((node/'.complete').exists())
 def test_corrupt_source_archive_is_rejected_and_retryable(self):
  archive=self.download/'source.tar.gz'; valid=archive.read_bytes(); archive.write_bytes(b'corrupt')
  self.run_install('--prepare-only',ok=False)
  self.assertFalse((self.install/'dsh').exists())
  self.assertFalse((self.install/f'upstream-{self.commit}.tar.gz').exists())
  archive.write_bytes(valid); self.run_install('--prepare-only')
  self.assertEqual((self.install/'dsh/example').read_text(),'new\n')
if __name__=='__main__': unittest.main(verbosity=2)
