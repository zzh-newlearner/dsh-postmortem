import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateVerifiedPairs } from '../dist/index.js'

const root = dirname(fileURLToPath(import.meta.url))
const input = join(root, '../datasets/synthetic-verified-paired-v1/records.jsonl')
const text = await readFile(input, 'utf8')
const records = text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const result = evaluateVerifiedPairs(records)

console.log(JSON.stringify({ dataset: 'synthetic-verified-paired-v1', ...result }, null, 2))
