// utils/r2Upload.js
//
// Cloudflare R2 upload/delete helper. Everything else in the app should
// go through these functions rather than touching the S3 client or
// building URLs directly.
//
// Reads these from your .env (which lives at routes/.env in this
// project — NOT project root):
//   CLOUD_ACCOUNT_ID     -> R2 account id (used to build the endpoint)
//   BUCKET_NAME           -> R2 bucket name
//   ACCESS_KEY_ID         -> R2 access key id
//   SECRET_ACCESS_KEY     -> R2 secret access key
//   CLOUD_PUBLIC_URI      -> public base URL for the bucket (r2.dev or custom domain)
//
// NOTE: TOKEN_VALUE (your Cloudflare API token) is NOT used here — that's
// for Cloudflare's management API, not the S3-compatible object storage
// API this file talks to.
//
// Requires: npm install @aws-sdk/client-s3 uuid

const path = require('path');

// IMPORTANT: dotenv's `path` option resolves relative to process.cwd()
// (wherever you ran `node`/`nodemon` from), NOT relative to this file.
// path.resolve(__dirname, ...) anchors it to this file's actual location
// on disk, so it works no matter what directory you launch the server
// from. (This was the bug — "../routes/.env" was resolving to a
// nonexistent folder one level ABOVE your project root.)
require('dotenv').config({ path: path.resolve(__dirname, '../routes/.env') });

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');

const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CLOUD_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.ACCESS_KEY_ID,
        secretAccessKey: process.env.SECRET_ACCESS_KEY,
    },
});

const BUCKET = process.env.BUCKET_NAME;
const PUBLIC_URL = (process.env.CLOUD_PUBLIC_URI || '').replace(/\/$/, '');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

// Fail loudly at startup if the env vars didn't load, instead of silently
// uploading to "https://undefined.r2.cloudflarestorage.com" — that's
// exactly the bug that was happening before.
if (!process.env.CLOUD_ACCOUNT_ID || !BUCKET || !PUBLIC_URL) {
    console.error(
        '⚠️  r2Upload.js: one or more R2 env vars are missing/undefined. ' +
        `Loaded from: ${path.resolve(__dirname, '../routes/.env')}\n` +
        `   CLOUD_ACCOUNT_ID=${process.env.CLOUD_ACCOUNT_ID}\n` +
        `   BUCKET_NAME=${process.env.BUCKET_NAME}\n` +
        `   CLOUD_PUBLIC_URI=${process.env.CLOUD_PUBLIC_URI}\n` +
        '   Double-check routes/.env actually contains these keys and has no typos.'
    );
}

/**
 * Convert a stored R2 object key into the full public URL the browser
 * can actually load. ALWAYS use this instead of handing raw keys to
 * the frontend.
 * @param {string} key
 * @returns {string|null}
 */
function keyToUrl(key) {
    if (!key) return null;
    return `${PUBLIC_URL}/${key}`;
}

/**
 * Upload a single in-memory file buffer to R2.
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @param {string} originalName
 * @param {string} folder  e.g. 'products'
 * @returns {Promise<{ key: string, url: string }>}
 */
async function uploadImage(buffer, mimetype, originalName, folder = 'products') {
    if (!ALLOWED_MIME.has(mimetype)) {
        throw new Error(`Unsupported image type: ${mimetype}`);
    }

    const ext = path.extname(originalName || '') || `.${mimetype.split('/')[1]}`;
    const key = `${folder}/${uuidv4()}${ext}`;

    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
    }));

    return { key, url: keyToUrl(key) };
}

/**
 * Upload multiple files (from multer's memory storage) in parallel.
 * @param {Array<{buffer:Buffer, mimetype:string, originalname:string}>} files
 * @param {string} folder
 */
async function uploadImages(files, folder = 'products') {
    return Promise.all(files.map(f => uploadImage(f.buffer, f.mimetype, f.originalname, folder)));
}

/**
 * Delete a single object from R2 by its stored key.
 * @param {string} key
 */
async function deleteImage(key) {
    if (!key) return;
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/**
 * Delete multiple objects.
 * @param {string[]} keys
 */
async function deleteImages(keys) {
    await Promise.all((keys || []).map(deleteImage));
}

module.exports = { uploadImage, uploadImages, deleteImage, deleteImages, keyToUrl };