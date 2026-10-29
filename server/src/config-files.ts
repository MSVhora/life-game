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
 *
 * If CONFIG_DEFAULTS_DIR is set (the Docker image sets it to its built-in copy of the examples),
 * that directory is tried after `dir`, so a deployment works with no config folder mounted at all.
 */
export function loadConfigFile<T = unknown>(
  dir: string,
  name: string,
  ext: 'yml' | 'json' = 'yml',
): LoadedFile<T> {
  const dirs = [dir, process.env.CONFIG_DEFAULTS_DIR].filter((d): d is string => !!d);
  for (const d of dirs) {
    for (const source of ['local', 'example'] as const) {
      const file = path.join(d, `${name}.${source}.${ext}`);
      if (existsSync(file)) {
        const text = readFileSync(file, 'utf8');
        const data = (ext === 'json' ? JSON.parse(text) : parseYaml(text)) as T;
        return { data, source, path: file };
      }
    }
  }
  throw new Error(`No ${name}.local.${ext} or ${name}.example.${ext} in ${dirs.join(' or ')}`);
}
