/**
 * OpenAPI 3 description of the REST API. Real-time canvas, chat and call traffic uses
 * Socket.IO and is documented in the `x-socket-events` section.
 */
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Board room id' }
const versionId = { name: 'versionId', in: 'path', required: true, schema: { type: 'string' } }
const accessHeaders = [
  { name: 'X-Board-Password', in: 'header', schema: { type: 'string' }, description: 'Required for password-protected boards' },
  { name: 'X-Session-Id', in: 'header', schema: { type: 'string' }, description: 'Resume a locked board (with X-Session-Token)' },
  { name: 'X-Session-Token', in: 'header', schema: { type: 'string' } },
]
const json = schema => ({ content: { 'application/json': { schema } } })
const error = { description: 'Error', ...json({ $ref: '#/components/schemas/Error' }) }
const denied = { description: 'Access denied (password, sign-in or locked)', ...json({ $ref: '#/components/schemas/Error' }) }

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Zephros API',
    version: '1.0.0',
    description: 'Real-time collaborative whiteboard. REST handles boards, accounts, chat history and version history; live editing runs over Socket.IO.',
  },
  servers: [{ url: '/api' }],
  tags: [
    { name: 'Health' }, { name: 'Boards' }, { name: 'Versions' }, { name: 'Chat' }, { name: 'Account' },
  ],
  components: {
    securitySchemes: { firebase: { type: 'http', scheme: 'bearer', bearerFormat: 'Firebase ID token' } },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' }, reason: { type: 'string' } } },
      Board: {
        type: 'object',
        properties: {
          roomId: { type: 'string' }, title: { type: 'string' }, persistent: { type: 'boolean' },
          ownerUid: { type: 'string', nullable: true }, requireAuth: { type: 'boolean' },
          isLocked: { type: 'boolean' }, hasPassword: { type: 'boolean' },
        },
      },
      Element: {
        type: 'object', required: ['id', 'type'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['rectangle', 'circle', 'line', 'arrow', 'text', 'sticky', 'pen', 'image', 'frame'] },
          x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
          points: { type: 'array', items: { type: 'number' } }, fill: { type: 'string' }, stroke: { type: 'string' },
          strokeWidth: { type: 'number' }, text: { type: 'string' },
        },
      },
      Version: {
        type: 'object',
        properties: {
          id: { type: 'string' }, label: { type: 'string' }, auto: { type: 'boolean' }, count: { type: 'integer' },
          createdBy: { type: 'object', nullable: true, properties: { uid: { type: 'string', nullable: true }, username: { type: 'string' } } },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      ChatMessage: {
        type: 'object',
        properties: {
          id: { type: 'string' }, message: { type: 'string' }, username: { type: 'string' }, color: { type: 'string' },
          sessionId: { type: 'string' }, timestamp: { type: 'string', format: 'date-time' },
          mentions: { type: 'array', items: { type: 'object', properties: { sessionId: { type: 'string' }, username: { type: 'string' } } } },
          reactions: { type: 'array', items: { type: 'object', properties: { emoji: { type: 'string' }, sessionIds: { type: 'array', items: { type: 'string' } } } } },
        },
      },
    },
  },
  paths: {
    '/health': { get: { tags: ['Health'], summary: 'Service and database status', responses: { 200: { description: 'Healthy' }, 503: { description: 'Database unavailable' } } } },
    '/board/create': {
      post: {
        tags: ['Boards'], summary: 'Create a board (guests get a temporary board)', security: [{}, { firebase: [] }],
        requestBody: json({ type: 'object', properties: { title: { type: 'string', maxLength: 200 }, persistent: { type: 'boolean', description: 'Saved board; requires sign-in' } } }),
        responses: { 201: { description: 'Created', ...json({ type: 'object', properties: { boardId: { type: 'string' }, shareUrl: { type: 'string' }, board: { $ref: '#/components/schemas/Board' } } }) }, 400: error, 401: error },
      },
    },
    '/board/{id}': {
      get: {
        tags: ['Boards'], summary: 'Board and elements, or a locked stub', parameters: [id, ...accessHeaders],
        responses: { 200: { description: 'Board', ...json({ type: 'object', properties: { board: { $ref: '#/components/schemas/Board' }, elements: { type: 'array', items: { $ref: '#/components/schemas/Element' } }, locked: { type: 'boolean' }, reason: { type: 'string' } } }) }, 404: error, 429: error },
      },
      patch: {
        tags: ['Boards'], summary: 'Rename (participants) or change settings (owner)', parameters: [id, ...accessHeaders], security: [{}, { firebase: [] }],
        requestBody: json({ type: 'object', properties: { title: { type: 'string' }, persistent: { type: 'boolean' }, requireAuth: { type: 'boolean' }, isLocked: { type: 'boolean' }, linkAccess: { type: 'string', enum: ['edit', 'view'], description: 'What the plain board link allows (owner only)' }, password: { type: 'string' }, clearPassword: { type: 'boolean' } } }),
        responses: { 200: { description: 'Updated; BOARD_UPDATED is broadcast to the room' }, 401: error, 403: denied },
      },
      delete: { tags: ['Boards'], summary: 'Delete a board and all its data (owner)', parameters: [id], security: [{ firebase: [] }], responses: { 200: { description: 'Deleted; BOARD_DELETED is broadcast' }, 403: error } },
    },
    '/board/{id}/duplicate': { post: { tags: ['Boards'], summary: 'Copy a board into your saved boards', parameters: [id, ...accessHeaders], security: [{ firebase: [] }], responses: { 201: { description: 'Copied' }, 403: denied } } },
    '/board/{id}/verify-access': {
      post: { tags: ['Boards'], summary: 'Check a board password (10 wrong guesses per 15 min)', parameters: [id], requestBody: json({ type: 'object', required: ['password'], properties: { password: { type: 'string' } } }), responses: { 200: { description: 'Valid' }, 403: error, 429: error } },
    },
    '/board/{id}/export/json': { get: { tags: ['Boards'], summary: 'Export board data', parameters: [id, ...accessHeaders], responses: { 200: { description: 'Board and elements' }, 403: denied } } },
    '/board/{id}/share': {
      get: {
        tags: ['Boards'], summary: 'Share settings — what the board link allows (edit/view) and the secret editor link (owner only)', parameters: [id],
        responses: { 200: { description: 'Share settings', ...json({ type: 'object', properties: { linkAccess: { type: 'string', enum: ['edit', 'view'] }, editLinkToken: { type: 'string' } } }) }, 401: error, 403: error },
      },
    },
    '/board/{id}/share/reset': {
      post: { tags: ['Boards'], summary: 'Create a new editor link; people who joined through the old one become viewers (owner only)', parameters: [id], responses: { 200: { description: 'New share settings' }, 401: error, 403: error } },
    },
    '/board/{id}/attendance': {
      get: {
        tags: ['Boards'], summary: 'Download the attendance register as an Excel (.xlsx) file — board owner only',
        parameters: [id, { name: 'tz', in: 'query', description: 'IANA time zone for the times, e.g. Asia/Kolkata', schema: { type: 'string', default: 'UTC' } }, ...accessHeaders],
        responses: { 200: { description: 'Excel workbook', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: { type: 'string', format: 'binary' } } } }, 401: error, 403: denied },
      },
    },
    '/board/{id}/chat': {
      get: {
        tags: ['Chat'], summary: 'Recent chat history, oldest first', parameters: [id, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 } }, ...accessHeaders],
        responses: { 200: { description: 'Messages', ...json({ type: 'object', properties: { messages: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } } } }) }, 403: denied },
      },
    },
    '/board/{id}/versions': {
      get: { tags: ['Versions'], summary: 'List versions, newest first', parameters: [id, ...accessHeaders], responses: { 200: { description: 'Versions', ...json({ type: 'object', properties: { versions: { type: 'array', items: { $ref: '#/components/schemas/Version' } }, canManage: { type: 'boolean' } } }) }, 403: denied } },
      post: {
        tags: ['Versions'], summary: 'Snapshot the board as stored on the server', parameters: [id, ...accessHeaders],
        requestBody: json({ type: 'object', properties: { label: { type: 'string', maxLength: 80 }, author: { type: 'string', description: 'Display name for guests' } } }),
        responses: { 201: { description: 'Created', ...json({ type: 'object', properties: { version: { $ref: '#/components/schemas/Version' } } }) }, 403: denied, 413: error },
      },
    },
    '/board/{id}/versions/{versionId}': {
      get: { tags: ['Versions'], summary: 'One version including its elements', parameters: [id, versionId, ...accessHeaders], responses: { 200: { description: 'Version' }, 404: error } },
      delete: { tags: ['Versions'], summary: 'Delete a version (owner, or anyone on an ownerless board)', parameters: [id, versionId, ...accessHeaders], responses: { 200: { description: 'Deleted' }, 403: error, 404: error } },
    },
    '/board/{id}/versions/{versionId}/restore': {
      post: { tags: ['Versions'], summary: 'Restore a version for everyone (takes a "Before restoring" snapshot first)', parameters: [id, versionId, ...accessHeaders], responses: { 200: { description: 'Restored; SYNC_STATE is broadcast' }, 403: error, 404: error } },
    },
    '/auth/sync': { post: { tags: ['Account'], summary: 'Create or update your profile after Google sign-in', security: [{ firebase: [] }], responses: { 200: { description: 'Profile' }, 401: error, 503: error } } },
    '/auth/me': { get: { tags: ['Account'], summary: 'Your profile', security: [{ firebase: [] }], responses: { 200: { description: 'Profile' }, 401: error } } },
    '/auth/profile': { patch: { tags: ['Account'], summary: 'Change display name', security: [{ firebase: [] }], requestBody: json({ type: 'object', properties: { displayName: { type: 'string', maxLength: 80 } } }), responses: { 200: { description: 'Profile' }, 400: error } } },
    '/auth/boards': { get: { tags: ['Account'], summary: 'Your 50 most recent boards', security: [{ firebase: [] }], responses: { 200: { description: 'Board history' } } } },
    '/auth/boards/visit': { post: { tags: ['Account'], summary: 'Record a board visit', security: [{ firebase: [] }], requestBody: json({ type: 'object', required: ['boardId'], properties: { boardId: { type: 'string' } } }), responses: { 200: { description: 'Recorded' }, 404: error } } },
  },
  'x-socket-events': {
    clientToServer: ['JOIN_BOARD', 'LEAVE_BOARD', 'HEARTBEAT', 'ADD_ELEMENT', 'UPDATE_ELEMENT', 'DELETE_ELEMENT', 'CLEAR_BOARD', 'SYNC_STATE (undo/redo patches)', 'CURSOR_MOVE', 'LASER_POINTER', 'CANVAS_REACTION', 'CHAT_MESSAGE', 'CHAT_REACTION', 'CHAT_CLEAR', 'CHAT_TYPING', 'CALL_JOIN', 'CALL_LEAVE', 'MEDIA_STATE', 'WEBRTC_OFFER/ANSWER', 'ICE_CANDIDATE', 'SCREEN_SHARE_START/STOP/OFFER/ANSWER/ICE', 'KICK_USER', 'MUTE_USER'],
    serverToClient: ['BOARD_STATE (elements, users, chat)', 'PRESENCE_UPDATE', 'ADD/UPDATE/DELETE_ELEMENT', 'SYNC_STATE', 'CHAT_MESSAGE', 'CHAT_REACTION (authoritative reactions)', 'CHAT_CLEARED', 'BOARD_UPDATED', 'BOARD_DELETED', 'ACTIVITY_EVENT', 'OPERATION_ERROR', 'JOIN_ERROR'],
  },
}

/** Swagger UI page (assets from a pinned CDN version). */
export const swaggerHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zephros API docs</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css">
<style>body{margin:0;background:#FAF9F6}.topbar{display:none}</style></head>
<body><div id="docs"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>window.ui = SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#docs', deepLinking: true })</script>
</body></html>`
