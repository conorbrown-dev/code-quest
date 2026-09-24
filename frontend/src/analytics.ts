const api = import.meta.env.VITE_API_BASE_URL ?? "";

const learnerId = (() => {
  const current = localStorage.getItem("pathway-learner-id");
  if (current) return current;
  const next = crypto.randomUUID();
  localStorage.setItem("pathway-learner-id", next);
  return next;
})();

const sessionId = (() => {
  const current = sessionStorage.getItem("pathway-session-id");
  if (current) return current;
  const next = crypto.randomUUID();
  sessionStorage.setItem("pathway-session-id", next);
  return next;
})();

export const getAnonymousLearnerId = () => learnerId;
export const getActivitySessionId = () => sessionId;

export type ActivityEvent = {
  eventType:
    | "session_start"
    | "course_view"
    | "lesson_view"
    | "workspace_view"
    | "exercise_submit"
    | "hook_run";
  courseId?: string | null;
  lessonSlug?: string | null;
  workspace?: string | null;
  detail?: string | null;
};

export async function trackActivity(event: ActivityEvent) {
  try {
    await fetch(`${api}/api/activity`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Learner-Id": learnerId,
      },
      body: JSON.stringify({
        ...event,
        sessionId,
      }),
      keepalive: true,
    });
  } catch {
    // Analytics must never interfere with the learning experience.
  }
}
