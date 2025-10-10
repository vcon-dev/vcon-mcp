import { VConQueries } from '../db/queries.js';

export interface ResourceDescriptor {
  uri: string;
  name: string;
  mimeType: string;
}

export function getCoreResources(): ResourceDescriptor[] {
  return [
    { uri: 'vcon://uuid/{uuid}', name: 'Get vCon by UUID', mimeType: 'application/json' },
    { uri: 'vcon://uuid/{uuid}/metadata', name: 'Get vCon metadata', mimeType: 'application/json' },
    { uri: 'vcon://uuid/{uuid}/parties', name: 'Get parties array', mimeType: 'application/json' },
    { uri: 'vcon://uuid/{uuid}/dialog', name: 'Get dialog array', mimeType: 'application/json' },
    { uri: 'vcon://uuid/{uuid}/dialog/{index}', name: 'Get dialog by index', mimeType: 'application/json' },
    { uri: 'vcon://uuid/{uuid}/attachments', name: 'Get attachments array', mimeType: 'application/json' },
    { uri: 'vcon://uuid/{uuid}/attachments/{index}', name: 'Get attachment by index', mimeType: 'application/json' },
    { uri: 'vcon://uuid/{uuid}/analysis', name: 'Get analysis array', mimeType: 'application/json' },
    { uri: 'vcon://uuid/{uuid}/analysis/{type}', name: 'Get analysis by type', mimeType: 'application/json' },
  ];
}

export async function resolveCoreResource(queries: VConQueries, uri: string): Promise<{ mimeType: string; content: any } | undefined> {
  // Simple parser for the vcon:// URIs
  const matchUuid = uri.match(/^vcon:\/\/uuid\/([0-9a-f\-]{36})(.*)$/i);
  if (!matchUuid) return undefined;
  const uuid = matchUuid[1];
  const suffix = matchUuid[2] || '';

  const vcon = await queries.getVCon(uuid);

  const json = (data: any) => ({ mimeType: 'application/json', content: data });

  if (suffix === '' || suffix === '/') {
    return json(vcon);
  }

  if (suffix === '/metadata') {
    const { parties, dialog, analysis, attachments, ...meta } = vcon as any;
    return json(meta);
  }

  const parts = suffix.split('/').filter(Boolean);
  if (parts[0] === 'parties') {
    return json(vcon.parties || []);
  }
  if (parts[0] === 'dialog') {
    if (parts.length === 1) return json(vcon.dialog || []);
    const index = parseInt(parts[1], 10);
    return json((vcon.dialog && vcon.dialog[index]) ?? null);
  }
  if (parts[0] === 'attachments') {
    if (parts.length === 1) return json(vcon.attachments || []);
    const index = parseInt(parts[1], 10);
    return json((vcon.attachments && vcon.attachments[index]) ?? null);
  }
  if (parts[0] === 'analysis') {
    if (parts.length === 1) return json(vcon.analysis || []);
    const type = parts[1];
    return json((vcon.analysis || []).filter(a => a.type === type));
  }

  return undefined;
}


