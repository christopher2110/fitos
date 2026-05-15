// lib/drive/photos.js
// Owns: Google Drive photo upload for check-in progress photos
// Does NOT own: Sheets writes, auth credentials, HTTP handling

const { google } = require('googleapis');
const { Readable } = require('stream');
const { getAuth } = require('../sheets/client');

const PARENT_FOLDER_ID = process.env.DRIVE_PHOTOS_PARENT_FOLDER_ID || null;

/**
 * Find or create the folder path: <parent> / FitOS Photos / <clientId>
 * Returns the Drive folder ID.
 *
 * We search before creating to keep the folder tree clean across deploys.
 */
async function getOrCreateClientFolder(drive, clientId) {
  // Step 1: find or create the "FitOS Photos" root folder
  const rootName = 'FitOS Photos';
  let rootId = PARENT_FOLDER_ID;

  if (!rootId) {
    rootId = await findOrCreateFolder(drive, rootName, null);
  }

  // Step 2: find or create the per-client subfolder
  const clientFolderId = await findOrCreateFolder(drive, String(clientId), rootId);
  return clientFolderId;
}

async function findOrCreateFolder(drive, name, parentId) {
  const q = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const list = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
  if (list.data.files && list.data.files.length > 0) {
    return list.data.files[0].id;
  }

  const meta = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) meta.parents = [parentId];

  const created = await drive.files.create({
    requestBody: meta,
    fields: 'id',
  });
  return created.data.id;
}

/**
 * Upload a photo buffer to Drive under "FitOS Photos / {clientId} /".
 * For files >5 MB the googleapis client automatically uses a resumable upload.
 *
 * @param {Buffer}  fileBuffer
 * @param {string}  mimeType   e.g. "image/jpeg"
 * @param {string}  filename
 * @param {string}  clientId   used to scope the subfolder
 * @returns {Promise<string>}  Shareable Drive URL (webViewLink)
 */
async function uploadPhoto(fileBuffer, mimeType, filename, clientId) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const folderId = await getOrCreateClientFolder(drive, clientId);

  const created = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType,
      // Readable stream: googleapis uses resumable upload automatically for >5 MB
      body: Readable.from(fileBuffer),
    },
    fields: 'id, webViewLink',
  });

  const fileId = created.data.id;

  // Anyone with the link can view — coach can open it from the Sheet
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return created.data.webViewLink;
}

module.exports = { uploadPhoto };
