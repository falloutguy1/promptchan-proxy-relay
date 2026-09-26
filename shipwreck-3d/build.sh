set -e
cd "$(dirname "$0")"
npx esbuild src/main.js --bundle --minify --format=iife --target=es2020 --outfile=dist/bundle.js --log-level=warning
node -e "const fs=require('fs');const t=fs.readFileSync('template.html','utf8');const b=fs.readFileSync('dist/bundle.js','utf8').replace(/<\/script/gi,'<\\\\/script');fs.writeFileSync('shipwreck.html',t.split('/*BUNDLE*/').join(b));console.log('bytes',fs.statSync('shipwreck.html').size)"
