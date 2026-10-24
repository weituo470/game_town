// Metadata only. Recordings and lyric text are never shipped in this catalogue.
export const LOCAL_MUSIC_PROGRAMMES = Object.freeze([
  Object.freeze({ id: 'ordinary-road', title: '平凡之路', description: '远行、山海与平凡灯火' }),
  Object.freeze({ id: 'shanghai-bund', title: '上海滩', description: '粤语经典 · 江潮、外滩与沪上风云' }),
]);
export function getLocalMusicProgramme(id) { return LOCAL_MUSIC_PROGRAMMES.find(entry => entry.id === id) || null; }
