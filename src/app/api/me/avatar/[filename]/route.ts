import { NextResponse } from 'next/server';
import { apiRoute } from '@/server/api-route';
import { jsonError } from '@/server/http';
import {
  avatarContentType,
  isSafeAvatarFilename,
  readAvatarFile,
} from '@/server/domain/users';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/avatar/[filename] — authenticated profile-picture serving.
 *
 * The filename must match the generated safe pattern and be referenced by an
 * account row, so a crafted path cannot read other files. Traversal segments
 * are rejected before touching the filesystem.
 */
export const GET = apiRoute<{ filename: string }>(async ({ db, params }) => {
  const { filename } = params;
  if (!isSafeAvatarFilename(filename)) {
    return jsonError(404, 'avatar_not_found', 'Image not found.');
  }

  const referenced = db
    .prepare('SELECT 1 AS present FROM users WHERE avatar = ? LIMIT 1')
    .get(`/api/me/avatar/${filename}`) as { present: number } | undefined;
  if (!referenced) {
    return jsonError(404, 'avatar_not_found', 'Image not found.');
  }

  const buffer = readAvatarFile(filename);
  if (!buffer) {
    return jsonError(404, 'avatar_not_found', 'Image not found.');
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type': avatarContentType(filename),
      'content-length': String(buffer.length),
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
});
