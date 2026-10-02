import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type HostEndpoint =
  | { type: 'tcp'; host: string; port: number }
  | { type: 'socket'; path: string };

export interface DiscoveredHost {
  id: string;
  product: string;
  pid: number;
  protocolVersion: string;
  connectionToken: string;
  endpoint: HostEndpoint;
}

function registryRoots(): { product: string; directory: string }[] {
  const home = homedir();
  let root: string;

  if (process.platform === 'win32') {
    if (!process.env.APPDATA) return [];
    root = process.env.APPDATA;
  } else if (process.platform === 'darwin') {
    root = join(home, 'Library', 'Application Support');
  } else {
    root = process.env.XDG_CONFIG_HOME || join(home, '.config');
  }

  return ['Code', 'Code - Insiders'].map(product => ({
    product,
    directory: join(root, product, 'agent-host', 'local-endpoint', 'entries'),
  }));
}

function parseHost(raw: unknown, product: string): DiscoveredHost | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as Record<string, unknown>;
  const endpoint = value.endpoint as Record<string, unknown> | undefined;

  if (
    value.schemaVersion !== 2 ||
    typeof value.pid !== 'number' ||
    typeof value.instanceId !== 'string' ||
    typeof value.protocolVersion !== 'string' ||
    typeof value.connectionToken !== 'string' ||
    !endpoint
  ) return;

  let parsed: HostEndpoint | undefined;
  if (
    endpoint.type === 'tcp' &&
    typeof endpoint.host === 'string' &&
    ['127.0.0.1', '::1', 'localhost'].includes(endpoint.host) &&
    typeof endpoint.port === 'number'
  ) {
    parsed = { type: 'tcp', host: endpoint.host, port: endpoint.port };
  } else if (endpoint.type === 'socket' && typeof endpoint.path === 'string') {
    parsed = { type: 'socket', path: endpoint.path };
  }

  if (!parsed) return;

  return {
    id: `${product}:${String(value.type)}:${value.pid}:${value.instanceId}`,
    product,
    pid: value.pid,
    protocolVersion: value.protocolVersion,
    connectionToken: value.connectionToken,
    endpoint: parsed,
  };
}

export async function discoverHosts(): Promise<DiscoveredHost[]> {
  const result = new Map<string, DiscoveredHost>();

  for (const { product, directory } of registryRoots()) {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      continue;
    }

    for (const name of names.filter(name => name.endsWith('.json'))) {
      try {
        const parsed = parseHost(
          JSON.parse(await readFile(join(directory, name), 'utf8')),
          product,
        );
        if (!parsed) continue;
        try {
          process.kill(parsed.pid, 0);
        } catch {
          continue;
        }
        result.set(parsed.id, parsed);
      } catch {
        // VS Code may replace registry files while being read.
      }
    }
  }

  return [...result.values()];
}

export async function resolveHost(id: string): Promise<DiscoveredHost> {
  const host = (await discoverHosts()).find(candidate => candidate.id === id);
  if (!host) throw new Error('Selected VS Code Agent Host is no longer available.');
  return host;
}
