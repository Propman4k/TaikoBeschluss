// DATA_DIR-Isolation: Tests schreiben nie in server/data (Muster aus TaikoEat).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'taikobeschluss-test-'))
process.env.NODE_ENV = 'test'
