const json = schema => ({ 'application/json': { schema } });
const message = { type: 'object', properties: { message: { type: 'string' } } };
const error = { description: 'Request failed', content: json({ type: 'object', properties: { error: { type: 'string' } } }) };
const user = { type: 'object', properties: { user: { type: 'object', properties: { id: { type: 'integer' }, email: { type: 'string' }, created_at: { type: 'string' } } } } };
const credentials = { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email', maxLength: 254 }, password: { type: 'string', format: 'password', minLength: 12, maxLength: 128 } } }, example: { email: 'demo@example.com', password: 'Demo-password-123' } } } };
const response = (description, schema) => ({ description, content: json(schema) });

export const openapi = {
  openapi: '3.0.3',
  info: { title: 'Node Auth API', version: '1.0.0', description: 'Test theo thứ tự: register → login → me → logout. Chọn Try it out rồi Execute. Sau login, copy accessToken vào Authorize (không thêm Bearer). Access token hết hạn sau 15 phút. Refresh cookie tự lưu, có hạn 7 ngày; gọi refresh để lấy accessToken mới và nhập lại Authorize. Logout thu hồi refresh token; access token còn hiệu lực đến khi hết hạn. Giới hạn 10 lần đăng ký/đăng nhập mỗi phút.' },
  servers: [{ url: '/' }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  paths: {
    '/health': { get: { tags: ['System'], summary: 'Kiểm tra server', responses: { 200: response('Server hoạt động', { type: 'object', properties: { status: { type: 'string', example: 'ok' } } }) } } },
    '/auth/register': { post: { tags: ['Auth'], summary: 'Đăng ký', requestBody: credentials, responses: { 202: response('Đã xử lý đăng ký (cùng phản hồi nếu email tồn tại)', message), 400: error, 413: error, 415: error, 429: error } } },
    '/auth/login': { post: { tags: ['Auth'], summary: 'Đăng nhập', requestBody: credentials, responses: { 200: { ...response('JWT access token và refresh cookie', { type: 'object', properties: { accessToken: { type: 'string' }, tokenType: { type: 'string', example: 'Bearer' }, expiresIn: { type: 'integer', example: 900 }, user: user.properties.user } }), headers: { 'Set-Cookie': { schema: { type: 'string' }, description: 'refresh_token cookie; HttpOnly; SameSite=Strict' } } }, 400: error, 401: error, 413: error, 415: error, 429: error } } },
    '/auth/me': { get: { tags: ['Auth'], summary: 'Thông tin tài khoản hiện tại', security: [{ bearerAuth: [] }], responses: { 200: response('Thông tin tài khoản', user), 401: error } } },
    '/auth/refresh': { post: { tags: ['Auth'], summary: 'Đổi refresh cookie lấy JWT mới', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' }, example: {} } } }, responses: { 200: response('JWT mới; refresh cookie được xoay vòng', { type: 'object', properties: { accessToken: { type: 'string' }, tokenType: { type: 'string' }, expiresIn: { type: 'integer' } } }), 401: error } } },
    '/auth/logout': { post: { tags: ['Auth'], summary: 'Đăng xuất', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' }, example: {} } } }, responses: { 200: response('Đã thu hồi phiên', message), 415: error } } }
  }
};

// Pinned assets from the official Swagger UI distribution.
export const docsHtml = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Node Auth — Swagger UI</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.34.1/swagger-ui.css">
</head><body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.34.1/swagger-ui-bundle.js" crossorigin="anonymous"></script>
<script>
if (typeof SwaggerUIBundle === 'undefined') {
  document.getElementById('swagger-ui').textContent = 'Không tải được Swagger UI. Kiểm tra kết nối Internet và tải lại trang.';
} else {
  SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true, withCredentials: true, validatorUrl: null, defaultModelsExpandDepth: -1 });
}
</script></body></html>`;
