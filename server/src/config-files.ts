import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface LoadedFile<T = unknown> {
  data: T;
  /** Which file was used: personal `*.local.*` file or the committed `*.example.*` fallback. */
  source: 'local' | 'example';
  path: string;
}

/**
 * Reads `<name>.local.<ext>` if it exists, otherwise `<name>.example.<ext>`.
 * Personal values live only in the gitignored local file.
 */
export function loadConfigFile<T = unknown>(
  dir: string,
  name: string,
  ext: 'yml' | 'json' = 'yml',
): LoadedFile<T> {
  for (const source of ['local', 'example'] as const) {
    const file = path.join(dir, `${name}.${source}.${ext}`);
    if (existsSync(file)) {
      const text = readFileSync(file, 'utf8');
      const data = (ext === 'json' ? JSON.parse(text) : parseYaml(text)) as T;
      return { data, source, path: file };
    }
  }
  throw new Error(`No ${name}.local.${ext} or ${name}.example.${ext} in ${dir}`);
}
