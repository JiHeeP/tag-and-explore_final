#!/usr/bin/env bash
# source-restored를 빌드해 recovered-deploy/assets에 복사하고,
# 운영 HTML(index.html, recovered-deploy/index.html, view/*/index.html)의 번들 파일명을 바꾼다.
set -euo pipefail
cd "$(dirname "$0")/.."

(cd source-restored && npm run build)

js=$(cd source-restored/dist/assets && ls index-*.js)
css=$(cd source-restored/dist/assets && ls index-*.css)
cp "source-restored/dist/assets/$js" "source-restored/dist/assets/$css" recovered-deploy/assets/

for html in index.html recovered-deploy/index.html view/*/index.html; do
  sed -i -E \
    -e "s#(/recovered-deploy/|\./)assets/index-[A-Za-z0-9_-]+\.js#\1assets/$js#" \
    -e "s#(/recovered-deploy/|\./)assets/index-[A-Za-z0-9_-]+\.css#\1assets/$css#" \
    "$html"
done

echo "배포 번들: $js, $css"
grep -hE "assets/index-" index.html recovered-deploy/index.html view/*/index.html
