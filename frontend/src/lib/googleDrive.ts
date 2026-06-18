const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client'

let tokenClient: { requestAccessToken: (opts: { prompt?: string }) => void } | null = null
let accessToken: string | null = null

function getClientId() {
  return import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined
}

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${GIS_SCRIPT}"]`)) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SCRIPT
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(script)
  })
}

export async function requestDriveAccess(): Promise<string> {
  const clientId = getClientId()
  if (!clientId) {
    throw new Error('Set VITE_GOOGLE_OAUTH_CLIENT_ID in .env (OAuth Web client ID from Google Cloud)')
  }

  await loadGis()

  return new Promise((resolve, reject) => {
    // @ts-expect-error google global from GIS
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp: { access_token?: string; error?: string }) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || 'Drive authorization failed'))
          return
        }
        accessToken = resp.access_token
        resolve(resp.access_token)
      },
    })
    tokenClient?.requestAccessToken({ prompt: '' })
  })
}

async function ensureToken(): Promise<string> {
  if (accessToken) return accessToken
  return requestDriveAccess()
}

async function findOrCreateAerixFolder(token: string): Promise<string> {
  const q = encodeURIComponent("name='Aerix' and mimeType='application/vnd.google-apps.folder' and trashed=false")
  const search = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await search.json()
  if (data.files?.[0]?.id) return data.files[0].id

  const create = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Aerix', mimeType: 'application/vnd.google-apps.folder' }),
  })
  const folder = await create.json()
  return folder.id
}

export async function uploadToGoogleDrive(file: Blob, filename: string): Promise<string> {
  const token = await ensureToken()
  const folderId = await findOrCreateAerixFolder(token)

  const metadata = { name: filename, parents: [folderId] }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', file)

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || 'Drive upload failed')
  }

  const result = await res.json()
  return result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`
}

export function isDriveConfigured() {
  return Boolean(import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID)
}
