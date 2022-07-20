# Gotdiff

## Install

```bash
sudo apt-get update
sudo apt-get upgrade -y
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 16
nvm use 16
nvm alias default 16
sudo apt-get install -y libcap2-bin
sudo apt-get install -y docker.io
sudo usermod -G docker -a ubuntu
newgrp docker
newgrp ubuntu
sudo setcap cap_net_bind_service=+ep `readlink -f \`which node\``
npm install -g pm2
git clone https://github.com/huksley/gotdiff
cd gotdiff
npm install
npm run redis
npm run build
pm2 startup
sudo env PATH=$PATH:/home/ubuntu/.nvm/versions/node/v16.16.0/bin /home/ubuntu/.nvm/versions/node/v16.16.0/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu
cat > .env
pm2 start ssl.js
```
