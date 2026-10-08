"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { Locale } from "@/i18n/locales";

/** Where each end-card widget sits in the 1080×1920 frame (percent), and from when it is on screen. */
type Hotspot = { key: "tryDemo" | "startTrial" | "annual"; href: string; from: number; box: { left: number; top: number; width: number; height: number } };

function showCaptions(video: HTMLVideoElement | null, on: boolean) {
  const track = video?.textTracks[0];
  if (track) track.mode = on ? "showing" : "hidden";
}

export const AD_VIDEO = { src: "/ad/smartmanager-ai-agent.mp4", poster: "/ad/poster.jpg", captions: "/ad/captions-en.vtt" } as const;

/**
 * The 30-second ad, full screen, with the end card's link cards made real:
 * transparent links laid exactly over the cards burned into the video, so a
 * viewer taps "Try our demo Agent" and lands in a conversation with Ziad.
 * The video keeps its 9:16 box (never cropped) so the links stay on their cards.
 */
export function AdPlayer({ locale }: { locale: Locale }) {
  const t = useTranslations("site.watch");
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [muted, setMuted] = useState(true);
  const [withSound, setWithSound] = useState(false);
  const [paused, setPaused] = useState(true);
  const [ended, setEnded] = useState(false);
  const [captions, setCaptions] = useState(false);

  const hotspots: Hotspot[] = [
    { key: "tryDemo", href: "/agent/smartmanager", from: 22.2, box: { left: 6.48, top: 45.12, width: 87.04, height: 13.33 } },
    { key: "startTrial", href: `/${locale}`, from: 22.65, box: { left: 6.48, top: 60.54, width: 87.04, height: 13.33 } },
    { key: "annual", href: `/${locale}/pricing`, from: 24.55, box: { left: 17.86, top: 75.74, width: 64.27, height: 4.79 } },
  ];

  // Start silently (browsers only autoplay muted); the big button restarts it with sound.
  useEffect(() => {
    video.current?.play().catch(() => setPaused(true));
  }, []);

  const playWithSound = () => {
    const v = video.current;
    if (!v) return;
    v.muted = false;
    setMuted(false);
    setWithSound(true);
    v.currentTime = 0;
    void v.play();
  };

  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (!withSound) return playWithSound();
    if (v.paused) void v.play();
    else v.pause();
  };

  const toggleMute = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.muted) setWithSound(true);
  };

  const toggleCaptions = () => {
    const next = !captions;
    showCaptions(video.current, next);
    setCaptions(next);
  };

  const replay = () => {
    setEnded(false);
    playWithSound();
  };

  const chip = "rounded-full bg-black/45 px-3.5 py-2 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-black/65 focus-visible:outline-2 focus-visible:outline-white";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[radial-gradient(circle_at_50%_0%,#0c6a53,#052a22_70%)]">
      <div className="relative aspect-[9/16] h-[min(100dvh,177.78vw)] overflow-hidden bg-black shadow-2xl" data-testid="ad-player">
        <video
          ref={video}
          className="absolute inset-0 h-full w-full"
          poster={AD_VIDEO.poster}
          muted={muted}
          playsInline
          autoPlay
          preload="metadata"
          onClick={togglePlay}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onEnded={() => setEnded(true)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          aria-label={t("videoLabel")}
          data-testid="ad-video"
        >
          <source src={AD_VIDEO.src} type="video/mp4" />
          <track src={AD_VIDEO.captions} kind="captions" srcLang="en" label="English" />
          {t("fallback")}
        </video>

        {hotspots.map((h) => {
          const live = ended || time >= h.from;
          return (
            <a
              key={h.key}
              href={h.href}
              aria-label={t(h.key)}
              tabIndex={live ? 0 : -1}
              aria-hidden={!live}
              data-testid={`ad-link-${h.key}`}
              className={`group absolute rounded-[1.6rem] transition-opacity duration-300 focus-visible:outline-4 focus-visible:outline-white ${live ? "opacity-100" : "pointer-events-none opacity-0"}`}
              style={{ left: `${h.box.left}%`, top: `${h.box.top}%`, width: `${h.box.width}%`, height: `${h.box.height}%` }}
            >
              <span className="absolute inset-0 animate-pulse rounded-[inherit] ring-4 ring-emerald-300/70 group-hover:ring-white" />
            </a>
          );
        })}

        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3">
          <a href={`/${locale}`} className={chip}>
            ✕ <span className="sr-only">{t("close")}</span>
          </a>
          <div className="flex gap-2">
            <button type="button" className={chip} onClick={toggleCaptions} aria-pressed={captions}>
              CC <span className="sr-only">{t("captions")}</span>
            </button>
            {withSound && (
              <button type="button" className={chip} onClick={toggleMute} data-testid="ad-mute">
                {muted ? "🔇" : "🔊"} <span className="sr-only">{muted ? t("unmute") : t("mute")}</span>
              </button>
            )}
          </div>
        </div>

        {!withSound && !ended && (
          <button
            type="button"
            onClick={playWithSound}
            data-testid="ad-play"
            className="absolute bottom-[8%] left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-white px-6 py-3.5 text-base font-bold text-emerald-900 shadow-xl transition hover:scale-105 focus-visible:outline-4 focus-visible:outline-emerald-300"
          >
            🔊 {t("play")}
          </button>
        )}
        {withSound && paused && !ended && (
          <button type="button" onClick={togglePlay} className={`${chip} absolute bottom-[8%] left-1/2 -translate-x-1/2 px-6 py-3 text-base`}>
            ▶ {t("resume")}
          </button>
        )}
        {ended && (
          <button type="button" onClick={replay} data-testid="ad-replay" className={`${chip} absolute bottom-[2.5%] left-1/2 -translate-x-1/2`}>
            ↻ {t("replay")}
          </button>
        )}
      </div>
    </div>
  );
}
