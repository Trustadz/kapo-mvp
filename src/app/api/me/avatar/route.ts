import { apiRoute } from '@/server/api-route';
import { jsonError, jsonOk } from '@/server/http';
import { AVATAR_ALLOWED_MIME, MAX_AVATAR_BYTES, saveAvatar } from '@/server/domain/users';

export const dynamic = 'force-dynamic';

/**
 * POST /api/me/avatar — upload a profile picture (multipart field `avatar`).
 *
 * Accepted: PNG, JPEG or WebP up to 2 MB, validated by magic bytes and stored
 * under UPLOAD_DIR/avatars. Images are served through the authenticated
 * `GET /api/me/avatar/[filename]` route, never from a public directory.
 */
export const POST = apiRoute(
  async ({ db, request, user }) => {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError(400, 'invalid_body', 'Send the image as multipart form data.');
    }

    const file = formData.get('avatar');
    if (!file || typeof file === 'string') {
      return jsonError(422, 'validation_failed', 'Choose an image to upload.', {
        avatar: 'Choose an image to upload.',
      });
    }
    if (file.size === 0) {
      return jsonError(422, 'validation_failed', 'Choose an image to upload.', {
        avatar: 'Choose an image to upload.',
      });
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return jsonError(413, 'avatar_too_large', 'Choose an image up to 2 MB.', {
        avatar: 'Choose an image up to 2 MB.',
      });
    }
    if (file.type && !(AVATAR_ALLOWED_MIME as readonly string[]).includes(file.type)) {
      return jsonError(415, 'unsupported_avatar', 'Choose a PNG, JPEG or WebP image.', {
        avatar: 'Choose a PNG, JPEG or WebP image.',
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const avatar = saveAvatar(db, user.id, buffer, file.type);
    return jsonOk({ avatar });
  },
  { mutation: true },
);
