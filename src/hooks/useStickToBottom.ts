import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How close to the bottom (in px) still counts as "at the bottom".
 *
 * Keep it small. With a big threshold (say 100px), a small scroll up still
 * counts as "at the bottom", so the next chunk snaps the user straight back
 * down. That is the classic chat-UI scroll bug.
 */
const BOTTOM_THRESHOLD = 8;

/**
 * Auto-scroll for a chat: follow new content while the user is at the bottom,
 * and stop following as soon as they scroll up to read something.
 *
 * Usage: attach `scrollRef` to the scrolling container, and `contentRef` to
 * the element inside it that grows (the message list). Show a "Jump to
 * latest" button when `isAtBottom` is false, and call `scrollToBottom()` from
 * it.
 *
 * How it decides:
 * - Following is controlled by "sticky". While it's on, every height change
 *   scrolls to the bottom.
 * - Only the user turns it off, by scrolling up or with an upward wheel
 *   tick. Content growing never changes scrollTop, so streaming text can't
 *   turn it off by accident.
 * - Scrolling back to the bottom by hand, or calling scrollToBottom(), turns
 *   it on again.
 */
export function useStickToBottom() {
  // ─── Refs and state ─────────────────────────────────────────────────────
  // The scrolling container, and the content inside it whose height changes.
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLOListElement>(null);

  // Whether we're following new content. It's a ref because the event
  // handlers below need its current value instantly, without waiting for a
  // render.
  const sticky = useRef(true);

  // The scroll position at the last scroll event. Comparing against it tells
  // us whether the user moved up or down.
  const lastTop = useRef(0);

  // The same value as `sticky`, but as state, so the component re-renders
  // and can show or hide the "Jump to latest" button.
  const [isAtBottom, setIsAtBottom] = useState(true);

  /**
   * Update the ref (for the handlers) and the state (for rendering)
   * together, so they never disagree. React skips the render if the value
   * hasn't changed, so this is cheap to call often.
   */
  const setSticky = useCallback((value: boolean) => {
    sticky.current = value;
    setIsAtBottom(value);
  }, []);

  // ─── Listeners (set up once, on mount) ──────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return; // Refs not attached yet.

    /**
     * Runs whenever the container scrolls, whether the user or our own code
     * scrolled it.
     *
     * - Within the threshold of the bottom → follow. This covers the user
     *   scrolling back down, and our own scrolls to the bottom.
     * - Otherwise, if the position moved *up* since last time → the user
     *   scrolled up to read, so stop following.
     * - Otherwise (moved down, but not all the way) → leave it as it is.
     */
    const onScroll = () => {
      const top = el.scrollTop;
      const distance = el.scrollHeight - top - el.clientHeight; // px left below the visible area
      if (distance <= BOTTOM_THRESHOLD) setSticky(true);
      else if (top < lastTop.current) setSticky(false);
      lastTop.current = top;
    };

    /**
     * Mouse wheel or trackpad: stop following the moment the user scrolls
     * up.
     *
     * Why not wait for the scroll event? It can arrive after the next chunk
     * has already pulled the view back down, and the user's scroll is lost.
     * The wheel event fires first, so it wins that race.
     *
     * The scrollHeight check ignores wheel ticks when there's nothing to
     * scroll yet.
     */
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && el.scrollHeight > el.clientHeight) setSticky(false);
    };

    /**
     * Runs when the content or the container changes size. If we're
     * following, jump to the bottom. `lastTop` is updated too, so the scroll
     * event this causes isn't mistaken for the user moving.
     */
    const follow = () => {
      if (!sticky.current) return;
      el.scrollTop = el.scrollHeight;
      lastTop.current = el.scrollTop;
    };

    // A ResizeObserver catches *every* height change: new chunks, markdown
    // re-flowing (for example a code block closing), and new messages. An
    // effect on `messages` would miss layout-only changes.
    //   - observe(content): the message list grows as text streams in.
    //   - observe(el): the window or container resizes.
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    observer.observe(el);

    // `passive: true` tells the browser we never call preventDefault(), so
    // scrolling stays smooth.
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });

    // Remove everything when the component unmounts.
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
    };
  }, [setSticky]);

  // ─── Public action ──────────────────────────────────────────────────────
  /**
   * Scroll to the bottom and start following again. Used by the "Jump to
   * latest" button (smooth), and when the user sends a message ('auto', an
   * instant jump).
   *
   * sticky is turned on *before* scrolling, so the scroll events during a
   * smooth scroll (which move down) don't change anything, and new content
   * keeps being followed.
   */
  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const el = scrollRef.current;
      if (!el) return;
      setSticky(true);
      el.scrollTo({ top: el.scrollHeight, behavior });
    },
    [setSticky],
  );

  return { scrollRef, contentRef, isAtBottom, scrollToBottom };
}
