#!/usr/bin/env python3
"""Offline subprocess fixtures for the production Bash installer and launcher."""
import hashlib, json, os, pathlib, shutil, subprocess, tarfile, tempfile, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
class Installer(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.base=pathlib.Path(self.tmp.name)
  self.repo=self.base/'repo'; shutil.copytree(ROOT/'scripts',self.repo/'scripts'); self.commit='a'*40
  self.install=self.base/'install'; self.home=self.base/'user'; self.home.mkdir()
  self.bin=self.base/'bin'; self.bin.mkdir(); self.download=self.base/'download'; self.download.mkdir()
  patch=b'diff --git a/example b/example\n--- a/example\n+++ b/example\n@@ -1 +1 @@\n-old\n+new\n'
  (self.repo/'patch').write_bytes(patch)
  (self.repo/'dsh-ui.json').write_text(json.dumps({'commit':self.commit,'tarball':'fixture/source.tar.gz','file':'patch','sha256':hashlib.sha256(patch).hexdigest(),'runtime':'24.13.0','pnpm':'11.28.5','profile':'web'},indent=2))
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
 case "$2" in process.versions.node) echo 24.13.0;; *) echo file:///fixture-loader;; esac
elif [ "$1" = -v ]; then echo v24.13.0
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
  self.node_name=f'node-v24.13.0-{system}-{arch}.tar.gz'; self.archive(self.node,self.download/self.node_name)
  self.refresh_sums()
  self.executable(self.bin/'curl','''#!/bin/bash
out=''
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; --retry) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done
file="$DOWNLOAD/${url##*/}"
if [ -n "$out" ]; then cp "$file" "$out"; else cat "$file"; fi
''')
  self.env={**os.environ,'HOME':str(self.home),'DSH_HOME':str(self.base/'official'),'PATH':str(self.bin)+':'+os.environ['PATH'],'DOWNLOAD':str(self.download),'FAKE_PNPM':str(self.bin/'fake-pnpm'),'CAPTURE':str(self.base/'argv'),'DSH_UI_NODE_MIRROR':'fixture','EXPECTED_COMMIT':self.commit,'CAPTURE_BUILD_METADATA':str(self.base/'build-commit')}
 def tearDown(self): self.tmp.cleanup()
 def executable(self,p,s): p.write_text(s); p.chmod(0o755)
 def archive(self,p,d):
  with tarfile.open(d,'w:gz') as t: t.add(p,arcname=p.name)
 def refresh_sums(self): (self.download/'SHASUMS256.txt').write_text(hashlib.sha256((self.download/self.node_name).read_bytes()).hexdigest()+'  '+self.node_name+'\n')
 def run_install(self,*args,ok=True,**env):
  p=subprocess.run(['bash',str(self.repo/'scripts/install.sh'),'--dir',str(self.install),'--skip-plugins',*args],env={**self.env,**env},text=True,capture_output=True)
  self.assertEqual(p.returncode==0,ok,p.stdout+p.stderr); return p
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
