#!/bin/sh
docker run --memory 200m -v ${HOME}/.npm:/root/.npm --rm node:16-alpine sh -c "
cd
CI=1 NODE_ENV=production npm install --ignore-scripts --omit peer --no-audit $1 1>&2
export SIZE=\$(du -s node_modules)
node -e 'fs = require(\"fs\"); process.stdout.write(JSON.stringify({...JSON.parse(fs.readFileSync(\"package-lock.json\", { encoding: \"utf-8\"})), __size: 1024 * process.env.SIZE.split(\"\\t\")[0]}));'
"
