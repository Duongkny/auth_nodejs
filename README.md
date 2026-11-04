# Node Auth — JWT + Swagger

Node.js 24+. Chạy `npm install` trước lần khởi động đầu tiên.

Tạo secret riêng bằng PowerShell (chỉ chạy một lần, không ghi đè .env cũ):

```powershell
node -e "const fs=require('node:fs');fs.writeFileSync('.env','JWT_SECRET='+require('node:crypto').randomBytes(48).toString('hex')+'\n',{flag:'wx'})"
$env:PORT = '3001'
npm start
```

Mở http://localhost:3001/docs. Swagger cần Internet để tải giao diện.

1. POST /auth/register với email và password từ 12–128 ký tự.
2. POST /auth/login, copy `accessToken` trong JSON trả về.
3. Bấm Authorize, dán token (không thêm chữ Bearer).
4. GET /auth/me để lấy thông tin tài khoản.
5. POST /auth/refresh với `{}` để lấy accessToken mới; cập nhật lại Authorize.
6. POST /auth/logout với `{}` để thu hồi refresh token.

Access token là JWT HS256, hết hạn sau 15 phút; kiểm tra chữ ký, issuer, audience và loại token. Refresh token là chuỗi ngẫu nhiên, hash trong SQLite, lưu cookie HttpOnly/SameSite=Strict, hạn tuyệt đối 7 ngày và xoay vòng sau mỗi lần refresh. Token refresh cũ không được dùng lại. Logout không thu hồi JWT đã phát hành; JWT vẫn hợp lệ cho tới lúc hết hạn. Client nên xóa access token khi logout.

Tài khoản cũ được giữ nguyên trong data/auth.sqlite. Cookie session cũ không còn dùng được; cần đăng nhập lại. JWT_SECRET phải là bí mật ngẫu nhiên ít nhất 32 byte, giữ ổn định giữa các lần khởi động và không commit .env. Khi triển khai dùng HTTPS và NODE_ENV=production để bật Secure cookie. API thiết kế cùng origin, không bật CORS. Giới hạn đăng ký/đăng nhập 10 lần/phút theo IP trực tiếp; sau proxy cần giới hạn riêng ở proxy. Chưa bao gồm xác minh email, quên mật khẩu, MFA.

Chạy `npm test` để kiểm tra. Thư viện JWT: https://github.com/panva/jose
