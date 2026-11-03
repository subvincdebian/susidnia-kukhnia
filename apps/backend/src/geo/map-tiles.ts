export function mapTileConfiguration() {
  const template = (process.env.DELIVERY_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').trim();
  try {
    const url = new URL(template);
    const path = decodeURIComponent(url.pathname);
    if (template.length > 500 || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || !['{z}','{x}','{y}'].every((token) => path.split(token).length === 2)
        || /[{}]/.test(path.replace(/\{[zxy]\}/g,'')))
      throw new Error('invalid tile configuration');
    return {tile_url:template,tile_origin:url.origin};
  } catch {
    throw new Error('Некоректне налаштування DELIVERY_MAP_TILE_URL: потрібна HTTPS-адреса тайлів із {z}, {x}, {y} у шляху');
  }
}
