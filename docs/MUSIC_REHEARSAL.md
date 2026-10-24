# 本地音轨与无人机歌词排练

开源版本保留通用音轨导入、LRC时间轴、点阵文字、16K无人机编排和MP4导出实现，但不附带商业歌曲录音、歌词全文、B站视频或私人节目score。

打开 ?rehearsal=music，导入你有权使用的本地音频及同版本LRC。音频仅在本机浏览器解码，播放头作为唯一时间轴；可审核歌词时刻和编排再播放/导出。默认节目标题只是元数据，不代表录音或歌词已获公开传播许可。

离线分析脚本 scripts/prepare-music-rehearsal.py 将结果保存在明确指定、且不在public/src/shared内的目录。下载功能要求显式确认你具备使用权，不使用浏览器cookies或绕过访问限制。

WaveSurfer 8.0.3的原始BSD-3-Clause许可证与NOTICE保留在 src/vendor/wavesurfer-8.0.3/。
