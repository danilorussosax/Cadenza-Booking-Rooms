'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function removeProfilePhoto(url) {
  if (typeof url !== 'string' || !/^\/storage\/user-[\w.-]+\.(png|jpe?g|webp)$/.test(url)) return;
  try {
    await fs.unlink(path.join(__dirname, '..', 'uploads', path.basename(url)));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Retry durevole: i nomi conservano l'id anche dopo l'anonimizzazione dell'utente.
async function pruneDeletedUserPhotos() {
  const { User } = require('../models');
  const directory = path.join(__dirname, '..', 'uploads');
  let files;
  try {
    files = await fs.readdir(directory);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const file of files) {
    const match = /^user-(\d+)-[\w.-]+\.(png|jpe?g|webp)$/.exec(file);
    if (!match) continue;
    const user = await User.findByPk(Number(match[1]), { paranoid: false });
    if (!user || user.deletedAt) await removeProfilePhoto(`/storage/${file}`);
  }
}
module.exports = { removeProfilePhoto, pruneDeletedUserPhotos };
