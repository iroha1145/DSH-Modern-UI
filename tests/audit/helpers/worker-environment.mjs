import { Worker as Thread } from 'node:worker_threads'
import { afterAll } from 'vitest'

// jsdom fixtures execute the actual bundled worker in a second Node thread; browser fixtures use native Workers.
const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
const live = new Set()
class FixtureWorker {
  onmessage = null
  onerror = null
  thread
  stopped = false
  queue = []
  constructor(url) {
    live.add(this)
    void fetch(url)
      .then(response => response.text())
      .then(source => {
        if (this.stopped) return
        this.thread = new Thread(
          `const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=data=>parentPort.postMessage(data);parentPort.on('message',data=>globalThis.onmessage({data}));\n${source}`,
          { eval: true },
        )
        this.thread.on('message', data => this.onmessage?.({ data }))
        this.thread.on('error', error => this.onerror?.({ message: error.message, preventDefault() {} }))
        for (const value of this.queue) this.thread.postMessage(value)
        this.queue = []
      })
      .catch(error => {
        if (!this.stopped) this.onerror?.({ message: error.message, preventDefault() {} })
      })
  }
  postMessage(value) {
    if (this.stopped) return
    if (this.thread) this.thread.postMessage(value)
    else this.queue.push(value)
  }
  terminate() {
    this.stopped = true
    this.thread?.terminate()
    this.queue = []
    live.delete(this)
  }
}
Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FixtureWorker })
afterAll(() => {
  for (const worker of live) worker.terminate()
  if (original) Object.defineProperty(globalThis, 'Worker', original)
  else delete globalThis.Worker
})
