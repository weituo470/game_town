"""Local-only media -> measured timing. Does not bundle music in the application.

Use the isolated qa/deploy/music-tools/.venv interpreter. URL inspection is
read-only by default. Download requires an explicit operator permission flag;
no browser cookies, authentication bypass, proxies or retry loops are used.
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_lrc(source, duration_ms):
    offset = re.search(r"\[offset:([+-]?\d+)\]", source, re.I)
    offset = int(offset.group(1)) if offset else 0
    rows = {}
    for line in source.lstrip("\ufeff").splitlines():
        text = re.sub(r"\[[^\]]*\]", "", line).strip()
        if not text:
            continue
        for minute, second, fraction in re.findall(r"\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]", line):
            ms = int(minute) * 60000 + int(second) * 1000 + int(fraction.ljust(3, "0") or 0) + offset
            if 0 <= ms < duration_ms:
                rows.setdefault(ms, text[:240])
    starts = sorted(rows)
    if not starts:
        raise ValueError("LRC has no timestamps inside this audio")
    return [{"startMs": ms, "endMs": starts[i + 1] if i + 1 < len(starts) else duration_ms, "text": rows[ms]} for i, ms in enumerate(starts)]


def probe_url(url, out, download=False):
    import yt_dlp
    p = urlparse(url)
    if p.scheme != "https" or p.hostname not in {"www.bilibili.com", "bilibili.com"} or not re.fullmatch(r"/video/BV[0-9A-Za-z]+/?", p.path) or p.username or p.port:
        raise ValueError("Use a normal HTTPS Bilibili BV video URL")
    class Quiet:
        def debug(self, *args): pass
        def warning(self, *args): pass
        def error(self, *args): pass
    options = {"quiet": True, "logger": Quiet(), "no_warnings": True, "noplaylist": True,
               "socket_timeout": 15, "retries": 0, "extractor_retries": 0,
               "format": "bestaudio/best", "max_filesize": 100 * 1024 * 1024,
               "outtmpl": str(out / "source.%(ext)s"), "overwrites": False}
    try:
        with yt_dlp.YoutubeDL(options) as y:
            data = y.extract_info(url, download=download)
            safe = {key: data.get(key) for key in ["id", "title", "uploader", "duration", "license", "availability", "webpage_url"]}
            safe.update({"downloaded": download, "cookiesUsed": False, "subtitleLanguages": list(data.get("subtitles", {}))})
            write_json(out / "source-provenance.json", safe)
            return Path(y.prepare_filename(data)) if download else None
    except yt_dlp.utils.DownloadError as e:
        status = re.search(r"HTTP Error (\d+)", str(e))
        safe = {"url": url, "accessible": False, "httpStatus": int(status.group(1)) if status else None,
                "downloaded": False, "cookiesUsed": False, "reason": "Source unavailable; no access restrictions were bypassed"}
        write_json(out / "source-provenance.json", safe)
        raise RuntimeError("Source unavailable" + (" (HTTP " + status.group(1) + ")" if status else "")) from None


def prepare(args):
    root = Path(__file__).resolve().parents[1]
    out = Path(args.output).resolve()
    for blocked in [root / "public", root / "dist", root / "src", root / "shared"]:
        if out == blocked or blocked in out.parents:
            raise ValueError("Music and lyrics must stay outside published application roots")
    out.mkdir(parents=True, exist_ok=True)
    media = Path(args.input).resolve() if args.input else None
    if args.url:
        if args.download and not args.rights_confirmed:
            raise ValueError("Download requires --rights-confirmed; source-code licensing does not grant music rights")
        media = probe_url(args.url, out, args.download)
        if media is None:
            print(json.dumps({"probeOnly": True, "output": str(out / "source-provenance.json")}))
            return
    if not media or not media.is_file() or media.stat().st_size > 100 * 1024 * 1024:
        raise ValueError("Provide an existing local media file smaller than 100 MB")
    probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(media)]))
    duration_ms = round(float(probe["format"]["duration"]) * 1000)
    if not 15000 <= duration_ms <= 600000:
        raise ValueError("Rehearsal audio must last between 15 seconds and 10 minutes")
    wav = out / "analysis-mono.wav"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-i", str(media), "-vn", "-ac", "1", "-ar", "22050", "-t", "600", str(wav)], check=True)
    import numpy as np
    import librosa
    signal, sr = librosa.load(str(wav), sr=22050, mono=True)
    tempo, beat_times = librosa.beat.beat_track(y=signal, sr=sr, units="time")
    rms = librosa.feature.rms(y=signal, hop_length=512)[0]
    bins = np.array_split(np.abs(signal), min(1600, len(signal)))
    result = {"version": 1, "title": args.title, "durationMs": duration_ms,
              "sourceSha256": hashlib.sha256(media.read_bytes()).hexdigest(), "sourceName": media.name,
              "tempoBpm": float(np.asarray(tempo).ravel()[0]), "beats": [round(float(t) * 1000) for t in beat_times],
              "waveform": [round(float(np.max(b)), 4) for b in bins],
              "energy": [{"timeMs": round(i * 512 / sr * 1000), "rms": round(float(v), 5)} for i, v in enumerate(rms)],
              "lyrics": [], "timingStatus": "audio-measured-lyrics-not-aligned", "publishableMusic": False}
    if args.lrc:
        result["lyrics"] = parse_lrc(Path(args.lrc).read_text(encoding="utf-8-sig"), duration_ms)
        result["timingStatus"] = "imported-lrc-needs-review"
    elif args.transcribe:
        try:
            import whisperx
        except ImportError:
            raise RuntimeError("WhisperX is optional and not installed; use a same-version LRC or install WhisperX in the isolated environment") from None
        audio = whisperx.load_audio(str(wav))
        model = whisperx.load_model(args.whisper_model, "cpu", compute_type="int8", language="zh", download_root=str(out / "models"))
        transcript = model.transcribe(audio, batch_size=4, language="zh")
        del model
        align_model, metadata = whisperx.load_align_model(language_code="zh", device="cpu", model_dir=str(out / "models"))
        aligned = whisperx.align(transcript["segments"], align_model, metadata, audio, "cpu", return_char_alignments=False)
        result["lyrics"] = [{"startMs": round(s["start"] * 1000), "endMs": round(s["end"] * 1000), "text": s["text"]} for s in aligned["segments"]]
        result["timingStatus"] = "asr-aligned-needs-listening-review"
    write_json(out / "rehearsal-analysis.json", result)
    print(json.dumps({"output": str(out / "rehearsal-analysis.json"), "durationMs": duration_ms,
                      "beats": len(result["beats"]), "lyricCues": len(result["lyrics"]), "timingStatus": result["timingStatus"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input")
    source.add_argument("--url")
    parser.add_argument("--output", required=True)
    parser.add_argument("--title", default="平凡之路")
    parser.add_argument("--lrc")
    parser.add_argument("--transcribe", action="store_true")
    parser.add_argument("--whisper-model", default="small")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--rights-confirmed", action="store_true")
    try:
        prepare(parser.parse_args())
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(1, "Preparation stopped: " + str(error) + "\n")
