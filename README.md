# Trình xem Markdown

Site tĩnh, không cần build. Gồm `index.html` và `vercel.json`.

## Cách 1: Vercel CLI
```bash
npm i -g vercel
cd vercel-deploy
vercel          # lần đầu: đăng nhập, chấp nhận mặc định (Framework: Other)
vercel --prod   # đưa lên production
```

## Cách 2: GitHub
1. Tạo repo mới, đẩy 2 tệp `index.html` và `vercel.json` lên nhánh `main`.
2. Vào vercel.com/new, chọn repo, Framework Preset: **Other**, để trống Build Command và Output Directory.
3. Bấm Deploy.

## Cách 3: Kéo thả
Vào vercel.com/new, kéo thư mục `vercel-deploy` vào trang (hoặc dùng CLI ở trên).

Lưu ý: thư viện tệp và chú thích lưu bằng IndexedDB trong trình duyệt, theo từng tên miền và từng thiết bị.
