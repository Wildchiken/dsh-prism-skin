/**
 * 设置文件：host 半的唯一真相。
 *
 * - 写入走「临时文件 + rename」，权限 0600，崩溃也不会留下半个文件。
 * - 多个 DSH 进程（Desktop 和网页版）可能同时写：每次写都在锁里重新读磁盘再合并，
 *   按键记时间戳，不会互相覆盖。
 * - 文件坏了就当空存档，但先把坏文件留一份，不悄悄毁掉用户的数据。
 */
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { emptyDoc, mergeKeys, normalizeDoc } from '../shared/state.js'

const LOCK_STALE_MS = 3000
const LOCK_WAIT_MS = 400

/**
 * @param {NodeJS.ProcessEnv} [env] 环境变量
 * @returns {string} 设置文件路径
 */
export function defaultStatePath(env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME.length > 0 ? env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'dsh-prism-skin', 'state.json')
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** 文件型设置存档。方法都是同步的，同一进程内不会交错。 */
export class StateStore {
  /** @param {string} file 文件路径 */
  constructor(file) {
    this.file = file
  }

  /** @returns {import('../shared/state.js').Doc} 磁盘上的存档 */
  read() {
    let text
    try {
      text = readFileSync(this.file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyDoc()
      throw error
    }
    try {
      return normalizeDoc(JSON.parse(text))
    } catch {
      this.quarantine()
      return emptyDoc()
    }
  }

  /** 把解析不了的文件挪走，留给用户排查。 */
  quarantine() {
    try {
      renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
    } catch {
      // 挪不走也不影响继续工作
    }
  }

  /**
   * 合并一批带时间戳的键并落盘。
   * @param {Record<string, import('../shared/state.js').KeyEntry>} patch 补丁
   * @returns {{doc: import('../shared/state.js').Doc, changed: string[]}} 合并结果
   */
  merge(patch) {
    const release = this.lock()
    try {
      const { doc, changed } = mergeKeys(this.read(), patch)
      if (changed.length > 0) this.write(doc)
      return { doc, changed }
    } finally {
      release()
    }
  }

  /** @param {import('../shared/state.js').Doc} doc 要写的存档 */
  write(doc) {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = `${this.file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    try {
      writeFileSync(temp, JSON.stringify(doc), { encoding: 'utf8', mode: 0o600 })
      renameSync(temp, this.file)
    } catch (error) {
      rmSync(temp, { force: true })
      throw error
    }
  }

  /**
   * 进程间互斥。拿不到锁时最多等 400ms，然后不等了继续写：最坏只是丢一次并发写，
   * 比让用户的操作报错好。持锁的进程崩溃后，超过 3 秒的锁视为失效。
   * @returns {() => void} 释放函数
   */
  lock() {
    const path = `${this.file}.lock`
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const deadline = Date.now() + LOCK_WAIT_MS
    for (;;) {
      try {
        closeSync(openSync(path, 'wx', 0o600))
        return () => rmSync(path, { force: true })
      } catch (error) {
        if (error?.code !== 'EEXIST') return () => {}
      }
      try {
        if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) {
          rmSync(path, { force: true })
          continue
        }
      } catch {
        continue
      }
      if (Date.now() > deadline) return () => {}
      sleepSync(15)
    }
  }
}
