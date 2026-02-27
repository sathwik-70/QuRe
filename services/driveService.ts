const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_NAME = 'QURE records';

// Simple in-memory cache to avoid repeated folder lookups in a single session
let cachedFolderId: string | null = null;

export const ensureQuReFolder = async (token: string): Promise<string> => {
  if (cachedFolderId) return cachedFolderId;

  const query = encodeURIComponent(`name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);

  try {
    // 1. Check if folder exists
    const res = await fetch(`${DRIVE_API}?q=${query}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to access Drive API');
    }

    const data = await res.json();

    // Return existing folder if found
    if (data.files && data.files.length > 0) {
      cachedFolderId = data.files[0].id;
      return cachedFolderId!;
    }

    // 2. Create if not exists
    const createRes = await fetch(DRIVE_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
        description: 'QuRe Health Identity Ledger'
      })
    });

    if (!createRes.ok) throw new Error('Failed to create folder');

    const folder = await createRes.json();
    cachedFolderId = folder.id;
    return folder.id;
  } catch (error) {
    console.error("Drive Folder Error:", error);
    throw error;
  }
};

export const listDriveFiles = async (token: string, folderId: string) => {
  if (!folderId) return [];
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetch(`${DRIVE_API}?q=${query}&fields=files(id, name, mimeType)`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.files || [];
};

export const uploadFile = async (token: string, folderId: string, file: File): Promise<string> => {
  // Ensure folder ID is present. If not, try to get/create it on the fly.
  let targetFolderId = folderId;
  if (!targetFolderId) {
    targetFolderId = await ensureQuReFolder(token);
  }

  const metadata = { name: file.name, parents: [targetFolderId], mimeType: file.type };
  const boundary = 'b_o_u_n_d_a_r_y';

  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];

      // Strict Multipart Body formatting
      const body =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${file.type}\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        `${base64}\r\n` +
        `--${boundary}--`;

      const res = await fetch(`${UPLOAD_API}?uploadType=multipart&fields=id`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body
      });
      const json = await res.json();
      if (json.error) {
        reject(json.error);
      } else {
        // Grant "anyone with link" reader permissions so hospitals can view the file
        try {
          await fetch(`${DRIVE_API}/${json.id}/permissions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'reader', type: 'anyone' })
          });
        } catch (permError) {
          console.error("Failed to set file permissions:", permError);
        }
        resolve(json.id);
      }
    };
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
};

export const downloadFile = async (token: string, fileId: string): Promise<Blob> => {
  const res = await fetch(`${DRIVE_API}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return await res.blob();
};