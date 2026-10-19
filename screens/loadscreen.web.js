import { useEffect, useRef, useState } from 'react';

// Splash stays at least this long so it never flashes; longer if the app is still loading.
const MIN_VISIBLE_MS = 1800;
const EXIT_MS = 350;

/**
 * Animated splash (CSS): bulldog and PALINDROME® fade/scale in, a light shimmer sweeps across
 * both (masked to the bulldog's shape and clipped to the title text), then the splash fades out
 * once the app is ready (`ready`) and calls `onFinish`.
 */
export default function SplashScreen({ ready = false, onFinish }) {
  const [exiting, setExiting] = useState(false);
  const startedAt = useRef(Date.now());
  const finishing = useRef(false);

  useEffect(() => {
    if (!ready || finishing.current) return;
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt.current));
    const timer = setTimeout(() => {
      finishing.current = true;
      setExiting(true);
    }, wait);
    return () => clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => onFinish && onFinish(), EXIT_MS);
    return () => clearTimeout(timer);
  }, [exiting, onFinish]);

  return (
    <div style={{ ...styles.container, opacity: exiting ? 0 : 1 }}>
      <style>{`
        @keyframes splashIntro {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes splashSubtitle {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes splashShimmer {
          from { background-position: 150% 0; }
          to { background-position: -50% 0; }
        }
      `}</style>

      <img src="/images/bg.png" style={styles.background} alt="" />

      <div style={styles.contentContainer}>
        <div style={styles.intro}>
          <div style={styles.logoWrap}>
            <img src="/images/bulldog.png" style={styles.logo} alt="Palindrome Logo" />
            <div style={styles.logoShimmer} />
          </div>
          <h1 style={styles.title}>PALINDROME®</h1>
        </div>
        <p style={styles.subtitle}>BY GAMMA GAMES BY OXFORD</p>
      </div>
    </div>
  );
}

const SHIMMER_BAND =
  'linear-gradient(110deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0) 60%)';

const styles = {
  container: {
    position: 'relative',
    width: '100vw',
    height: '100vh',
    backgroundColor: '#000428',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    margin: 0,
    padding: 0,
    transition: `opacity ${EXIT_MS}ms ease-in`,
  },

  background: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },

  contentContainer: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },

  intro: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    animation: 'splashIntro 550ms cubic-bezier(0.215, 0.61, 0.355, 1) both',
  },

  logoWrap: {
    position: 'relative',
    width: '200px',
    height: '200px',
    marginBottom: '60px',
  },

  logo: {
    width: '200px',
    height: '200px',
    objectFit: 'contain',
    display: 'block',
  },

  // Light band masked to the bulldog's own pixels.
  logoShimmer: {
    position: 'absolute',
    inset: 0,
    backgroundImage: SHIMMER_BAND,
    backgroundSize: '250% 100%',
    backgroundRepeat: 'no-repeat',
    WebkitMaskImage: 'url(/images/bulldog.png)',
    maskImage: 'url(/images/bulldog.png)',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    animation: 'splashShimmer 1100ms ease-in-out 330ms infinite',
    pointerEvents: 'none',
  },

  // Blue title with the same light band clipped to the text.
  title: {
    margin: 0,
    textAlign: 'center',
    fontSize: 'clamp(28px, 7vw, 48px)',
    fontWeight: '700',
    letterSpacing: '6px',
    marginBottom: '10px',
    fontFamily: 'Geist-Bold',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    maxWidth: '95vw',
    overflow: 'hidden',
    textOverflow: 'clip',
    color: 'transparent',
    backgroundImage: `${SHIMMER_BAND}, linear-gradient(#0060FF, #0060FF)`,
    backgroundSize: '250% 100%, 100% 100%',
    backgroundRepeat: 'no-repeat',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    animation: 'splashShimmer 1100ms ease-in-out 330ms infinite',
  },

  subtitle: {
    margin: 0,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 'clamp(10px, 3.4vw, 14px)',
    fontWeight: '400',
    letterSpacing: 'clamp(2px, 1vw, 4px)',
    fontFamily: 'Geist-Regular',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    maxWidth: '92vw',
    animation: 'splashSubtitle 550ms ease-out 120ms both',
  },
};
