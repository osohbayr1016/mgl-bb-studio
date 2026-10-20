/**
 * `lib/mediaReplace.ts` — солигдсон зургийн хуучин R2 объектыг устгах дүрмийн тест.
 * Хамгийн чухал нь ХУДАЛ ЭЕРЭГ: хуваалцсан объект (`default-profile-photo.png`),
 * хавтастай түлхүүр, өөр мөрөөс ишлэгдсэн URL ХЭЗЭЭ Ч устгагдахгүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { deleteReplacedMedia, isUserUploadedMediaUrl, mediaKeyOfUrl } = await import(
  './mediaReplace.ts'
);

function fakeEnv(refCount: number) {
  const deleted: string[] = [];
  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => ({ n: refCount }) }),
      }),
    } as unknown as D1Database,
    MEDIA_BUCKET: {
      delete: async (key: string) => {
        deleted.push(key);
      },
    } as unknown as R2Bucket,
  };
  return { env, deleted };
}

const OLD = '/media/2-1785237893523-abc123def456-avatar.png';
const OLD_LEGACY = '/media/2-1785237893523-avatar.png';
const NEW = '/media/2-1785238000000-ffeeddccbbaa-avatar.png';

test('түлхүүрийн хэлбэр: зөвхөн хэрэглэгчийн байршуулсан /media/<нэг сегмент>', () => {
  assert.equal(isUserUploadedMediaUrl(OLD), true);
  assert.equal(isUserUploadedMediaUrl(OLD_LEGACY), true);
  assert.equal(isUserUploadedMediaUrl('/media/default-profile-photo.png'), false);
  assert.equal(isUserUploadedMediaUrl('/media/email%2F1%2Fx%2Fbody.html'), false);
  assert.equal(isUserUploadedMediaUrl('https://cdn.example.com/2-1785237893523-x.png'), false);
  assert.equal(isUserUploadedMediaUrl(null), false);
  assert.equal(mediaKeyOfUrl(OLD), '2-1785237893523-abc123def456-avatar.png');
});

test('солигдсон, хэн ч ишлээгүй → устгана', async () => {
  const { env, deleted } = fakeEnv(0);
  const r = await deleteReplacedMedia(env, OLD, NEW);
  assert.equal(r.deleted, true);
  assert.deepEqual(deleted, ['2-1785237893523-abc123def456-avatar.png']);
});

test('ижил утгаар дахин хадгалах / хоосон prev → устгахгүй', async () => {
  const { env, deleted } = fakeEnv(0);
  assert.equal((await deleteReplacedMedia(env, OLD, OLD)).reason, 'unchanged');
  assert.equal((await deleteReplacedMedia(env, null, NEW)).reason, 'no_prev');
  assert.equal((await deleteReplacedMedia(env, '', NEW)).reason, 'no_prev');
  assert.deepEqual(deleted, []);
});

test('хуваалцсан/хавтастай объект → устгахгүй', async () => {
  const { env, deleted } = fakeEnv(0);
  assert.equal(
    (await deleteReplacedMedia(env, '/media/default-profile-photo.png', NEW)).reason,
    'not_user_upload',
  );
  assert.equal(
    (await deleteReplacedMedia(env, '/media/client-reports%2Fx.pdf', NEW)).reason,
    'not_user_upload',
  );
  assert.deepEqual(deleted, []);
});

test('өөр мөр ишилсээр байвал → устгахгүй', async () => {
  const { env, deleted } = fakeEnv(1);
  const r = await deleteReplacedMedia(env, OLD, null);
  assert.equal(r.deleted, false);
  assert.equal(r.reason, 'still_referenced:1');
  assert.deepEqual(deleted, []);
});

test('зургийг АВАХ (next = null) нь хуучныг устгана', async () => {
  const { env, deleted } = fakeEnv(0);
  const r = await deleteReplacedMedia(env, OLD, null);
  assert.equal(r.deleted, true);
  assert.equal(deleted.length, 1);
});

test('R2 delete унасан ч шидэхгүй', async () => {
  const { env } = fakeEnv(0);
  (env.MEDIA_BUCKET as unknown as { delete: () => Promise<void> }).delete = async () => {
    throw new Error('r2 down');
  };
  const r = await deleteReplacedMedia(env, OLD, NEW);
  assert.equal(r.deleted, false);
  assert.equal(r.reason, 'r2_error');
});
