import { useEffect, useRef, useState, type ReactNode } from "react";
import Editor, { loader } from "@monaco-editor/react";
import "./onboarding.css";
import { ExperienceHub } from "./ExperienceHub";
import { getAnonymousLearnerId, trackActivity, trackActivityOnce } from "./analytics";
import {
  initializeKeycloak,
  keycloak,
  keycloakConfigured,
  loginWithKeycloak,
  logoutFromKeycloak,
} from "./keycloak";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Code2,
  Flame,
  FolderKanban,
  LockKeyhole,
  LogIn,
  LogOut,
  Play,
  RotateCcw,
  Sparkles,
  UserRound,
} from "lucide-react";

type Choice = { id: string; text: string };
type CircuitNode = { id: string; label: string; x: number; y: number; ground: boolean };
type CircuitComponent = { id: string; kind: string; label: string; fromNode: string; toNode: string; value?: string };
type CircuitMeasurement = { meterMode: string; redNode: string; blackNode: string; value?: number | null; unit: string; display: string };
type CircuitDefinition = {
  title: string;
  description: string;
  safetyNote: string;
  meterModes: string[];
  nodes: CircuitNode[];
  components: CircuitComponent[];
  measurements: CircuitMeasurement[];
  task: { instruction: string; diagnosisChoices: Choice[] };
};
type Exercise = {
  kind: "MultipleChoice" | "Code" | "Presentation" | "Numeric" | "Circuit";
  title: string;
  prompt: string;
  requirements: string[];
  starterCode?: string;
  choices: Choice[];
  hint: string;
  tests: string[];
  expectedNumeric?: number;
  tolerance?: number;
  unit?: string;
  unitConversions?: Record<string, number>;
  workedSolution?: string;
  circuit?: CircuitDefinition;
};
type Lesson = {
  slug: string;
  module: string;
  order: number;
  title: string;
  subtitle: string;
  concept: string;
  body: string;
  example: string;
  exercise: Exercise;
  nextSlug?: string;
  version: {
    language: string;
    framework: string;
    lastReviewed: string;
    sourceUrl: string;
  };
};
type Course = {
  id: string;
  title: string;
  languageId: string;
  languageVersion: string;
  frameworkVersion: string;
  lastReviewed: string;
  modules: {
    title: string;
    level: string;
    lessons: { slug: string; title: string; order: number }[];
  }[];
};
type CodeReview = { summary: string; suggestions: string[] };
type Result = {
  passed: boolean;
  passingTests: number;
  totalTests: number;
  feedback: string;
  nextLessonSlug?: string;
  codeReview?: CodeReview;
  workedSolution?: string;
  circuitReading?: { value?: number | null; unit: string; display: string };
};
type HookPlaygroundResult = {
  matcherMatched: boolean;
  executed: boolean;
  exitCode?: number | null;
  outcome: string;
  summary: string;
  reason?: string | null;
  stdout: string;
  stderr: string;
  inputJson: string;
};
type Account = {
  token: string;
  displayName: string;
  email: string;
  subject: string;
};
type Workspace =
  "learn" | "practice" | "projects" | "dashboard" | "community" | "coach";
const api = import.meta.env.VITE_API_BASE_URL ?? "";
const donationUrl = import.meta.env.VITE_DONATION_URL?.trim();
const accentOptions = [
  { id: "purple", label: "Purple", value: "#b981ff" },
  { id: "pink", label: "Pink", value: "#ff4fa3" },
  { id: "green", label: "Green", value: "#42f58d" },
  { id: "cyan", label: "Cyan", value: "#28dfff" },
  { id: "red", label: "Red", value: "#ff4d5f" },
  { id: "yellow", label: "Yellow", value: "#ffe34f" },
  { id: "orange", label: "Orange", value: "#ff9138" },
];
const applyAccent = (accent: string) => {
  const color =
    accentOptions.find((option) => option.id === accent)?.value ??
    accentOptions[0].value;
  document.documentElement.dataset.accent = accent;
  const favicon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0f0d17"/><path d="M14 34h17L25 52l25-28H34l6-12z" fill="${color}"/></svg>`)}`;
  document
    .querySelector<HTMLLinkElement>('link[rel="icon"]')
    ?.setAttribute("href", favicon);
};
const defaultCourseId = "csharp-dotnet";
type LearningLocation = { courseId: string | null; lessonSlug: string | null };
const parseLearningLocation = (pathname: string): LearningLocation => {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== "courses" || !parts[1]) return { courseId: null, lessonSlug: null };
  if (parts.length === 2) return { courseId: parts[1], lessonSlug: null };
  if (parts.length === 4 && parts[2] === "lessons" && parts[3])
    return { courseId: parts[1], lessonSlug: parts[3] };
  return { courseId: null, lessonSlug: null };
};
const coursePath = (courseId: string) => `/courses/${encodeURIComponent(courseId)}`;
const lessonPath = (courseId: string, lessonSlug: string) =>
  `${coursePath(courseId)}/lessons/${encodeURIComponent(lessonSlug)}`;
const learnerId = getAnonymousLearnerId();
const progressStorageKey = (owner: string) =>
  `pathway-completed-lessons:${owner}`;
const readProgress = (owner: string) => {
  const saved = localStorage.getItem(progressStorageKey(owner));
  return saved ? (JSON.parse(saved) as string[]) : [];
};
const apiHeaders = (account: Account | null): Record<string, string> =>
  account
    ? {
        "content-type": "application/json",
        Authorization: `Bearer ${account.token}`,
      }
    : { "content-type": "application/json", "X-Learner-Id": learnerId };

function App() {
  const initialLocation = parseLearningLocation(window.location.pathname);
  const [course, setCourse] = useState<Course | null>(null);
  const [courseId, setCourseId] = useState(
    () => initialLocation.courseId ?? localStorage.getItem("pathway-course-id") ?? defaultCourseId,
  );
  const requestedLessonRef = useRef<string | null>(initialLocation.lessonSlug);
  const [routeVersion, setRouteVersion] = useState(0);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [answer, setAnswer] = useState("");
  const [unit, setUnit] = useState("");
  const [meterMode, setMeterMode] = useState("");
  const [redProbe, setRedProbe] = useState("");
  const [blackProbe, setBlackProbe] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [completed, setCompleted] = useState<string[]>(() =>
    readProgress(`guest:${learnerId}`),
  );
  const [account, setAccount] = useState<Account | null>(null);
  const progressOwner = account
    ? `keycloak:${account.subject}`
    : `guest:${learnerId}`;
  const accountIdentity = account?.subject || "guest";
  const [onboarding, setOnboarding] = useState(
    () => !localStorage.getItem("pathway-onboarding-complete"),
  );
  const [workspace, setWorkspace] = useState<Workspace>("learn");
  useEffect(() => {
    trackActivityOnce("session_start", { eventType: "session_start" });
  }, []);
  useEffect(() => {
    trackActivityOnce(`course:${courseId}`, {
      eventType: "course_view",
      courseId,
    });
  }, [courseId]);
  useEffect(() => {
    if (!lesson) return;
    trackActivityOnce(`lesson:${lesson.slug}`, {
      eventType: "lesson_view",
      courseId,
      lessonSlug: lesson.slug,
    });
  }, [courseId, lesson?.slug]);
  useEffect(() => {
    trackActivityOnce(`workspace:${workspace}`, {
      eventType: "workspace_view",
      courseId,
      lessonSlug: lesson?.slug,
      workspace,
    });
  }, [courseId, lesson?.slug, workspace]);
  useEffect(
    () => applyAccent(localStorage.getItem("pathway-accent") ?? "purple"),
    [],
  );
  useEffect(() => {
    if (course)
      document.title = `Pathway — ${course.languageId === "claude" ? "Claude Engineering" : course.languageId === "computing" ? "Computing Foundations" : course.languageId === "electrical-engineering" ? "Electrical Engineering" : course.languageId === "git" ? "Git CLI" : course.id === "react-lite" ? "React Lite 2026" : course.id === "react-enterprise" ? "React 2026" : course.languageId === "web" ? "Web Development Basics" : `Learn ${course.languageId === "python" ? "Python" : course.languageId === "rust" ? "Rust" : "C#"}`}`;
  }, [course]);
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };
  useEffect(() => {
    initializeKeycloak()
      .then(setAccount)
      .catch(() => notify("Keycloak sign-in could not be initialized."));
  }, []);
  useEffect(() => {
    const client = keycloak;
    if (!client || !account) return;
    const refresh = window.setInterval(
      () =>
        client
          .updateToken(60)
          .then(() => {
            const refreshedToken = client.token;
            if (refreshedToken)
              setAccount((current) =>
                current && current.token !== refreshedToken
                  ? { ...current, token: refreshedToken }
                  : current,
              );
          })
          .catch(() => {
            setAccount(null);
            void loginWithKeycloak(false);
          }),
      30_000,
    );
    return () => window.clearInterval(refresh);
  }, [account]);
  const navigateToCourse = (id: string, historyMode: "push" | "replace" = "push") => {
    localStorage.setItem("pathway-course-id", id);
    requestedLessonRef.current = null;
    setCourseId(id);
    setRouteVersion((current) => current + 1);
    setWorkspace("learn");
    window.history[historyMode === "push" ? "pushState" : "replaceState"]({}, "", coursePath(id));
  };
  const loadLesson = async (slug: string, historyMode: "push" | "replace" | "none" = "push") => {
    setLoading(true);
    setResult(null);
    setAnswer("");
    setUnit("");
    setMeterMode("");
    setRedProbe("");
    setBlackProbe("");
    setDiagnosis("");
    try {
      const response = await fetch(`${api}/api/lessons/${slug}`);
      if (!response.ok) throw Error();
      const next: Lesson = await response.json();
      setLesson(next);
      requestedLessonRef.current = next.slug;
      setCode(next.exercise.starterCode ?? "");
      setUnit(next.exercise.unit ?? "");
      if (historyMode !== "none") {
        window.history[historyMode === "push" ? "pushState" : "replaceState"]({}, "", lessonPath(courseId, next.slug));
      }
    } catch {
      notify("Could not load that lesson. Check the API connection.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetch(`${api}/api/courses/${courseId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(async (nextCourse: Course) => {
        const ordered = nextCourse.modules
          .flatMap((module) => module.lessons)
          .sort((a, b) => a.order - b.order);
        if (!ordered.length) throw Error();
        const progress = await fetch(`${api}/api/progress`, { headers: apiHeaders(account) })
          .then((r) => (r.ok ? r.json() : null));
        const stored = progress?.completedLessonSlugs ?? readProgress(progressOwner);
        const requestedLessonSlug = requestedLessonRef.current;
        const requested = requestedLessonSlug && ordered.some((item) => item.slug === requestedLessonSlug)
          ? requestedLessonSlug
          : null;
        const currentLocation = parseLearningLocation(window.location.pathname);
        const explicitCourseOnlyRoute =
          currentLocation.courseId === courseId && currentLocation.lessonSlug === null;
        const nextAvailable = ordered.find((item) => !stored.includes(item.slug))?.slug ?? ordered.at(-1)!.slug;
        const targetSlug = requested ?? (explicitCourseOnlyRoute ? nextAvailable : ordered[0].slug);
        const lessonResponse = await fetch(`${api}/api/lessons/${targetSlug}`);
        if (!lessonResponse.ok) throw Error();
        const nextLesson: Lesson = await lessonResponse.json();
        return [nextCourse, nextLesson, stored] as const;
      })
      .then(([nextCourse, nextLesson, stored]) => {
        setCourse(nextCourse);
        setLesson(nextLesson);
        requestedLessonRef.current = nextLesson.slug;
        setCode(nextLesson.exercise.starterCode ?? "");
        setAnswer("");
        setUnit(nextLesson.exercise.unit ?? "");
        setMeterMode("");
        setRedProbe("");
        setBlackProbe("");
        setDiagnosis("");
        setCompleted(stored);
        localStorage.setItem("pathway-course-id", nextCourse.id);
        localStorage.setItem(progressStorageKey(progressOwner), JSON.stringify(stored));
        const canonical = lessonPath(nextCourse.id, nextLesson.slug);
        if (window.location.pathname !== canonical) window.history.replaceState({}, "", canonical);
      })
      .catch(() => notify("Start the API to load the curriculum."))
      .finally(() => setLoading(false));
  }, [accountIdentity, courseId, routeVersion]);

  useEffect(() => {
    const onPopState = () => {
      const location = parseLearningLocation(window.location.pathname);
      if (!location.courseId) return;
      localStorage.setItem("pathway-course-id", location.courseId);
      requestedLessonRef.current = location.lessonSlug;
      setCourseId(location.courseId);
      setRouteVersion((current) => current + 1);
      setWorkspace("learn");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const submit = async () => {
    if (!lesson) return;
    if (lesson.exercise.kind === "MultipleChoice" && !answer)
      return notify("Choose an answer first.");
    if (lesson.exercise.kind === "Numeric" && !answer.trim())
      return notify("Enter a numeric answer first.");
    if (lesson.exercise.kind === "Circuit" && (!meterMode || !redProbe || !blackProbe))
      return notify("Choose a meter mode and place both probes first.");
    if (lesson.exercise.kind === "Circuit" && lesson.exercise.circuit?.task.diagnosisChoices.length && !diagnosis)
      return notify("Choose a diagnosis before checking your circuit.");
    try {
      const response = await fetch(`${api}/api/submissions/validate`, {
        method: "POST",
        headers: apiHeaders(account),
        body: JSON.stringify({ lessonSlug: lesson.slug, answer, code, unit, meterMode, redProbe, blackProbe, diagnosis }),
      });
      if (!response.ok) throw Error();
      const next: Result = await response.json();
      setResult(next);
      void trackActivity({
        eventType: "exercise_submit",
        courseId,
        lessonSlug: lesson.slug,
        workspace,
        detail: next.passed ? "passed" : "failed",
      });
      if (next.passed) {
        setCompleted((current) => {
          const updated = [...new Set([...current, lesson.slug])];
          localStorage.setItem(
            progressStorageKey(progressOwner),
            JSON.stringify(updated),
          );
          return updated;
        });
        notify(next.feedback);
      }
    } catch {
      notify("Validation service is unavailable. Try again shortly.");
    }
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  if (loading && !lesson)
    return (
      <div className="app-dark grid min-h-screen place-items-center bg-canvas font-display text-2xl text-forest">
        Loading your learning path…
      </div>
    );
  if (!lesson || !course)
    return (
      <div className="app-dark grid min-h-screen place-items-center bg-canvas text-sm text-[#687169]">
        The curriculum API is unavailable.
      </div>
    );
  if (onboarding)
    return (
      <Onboarding
        course={course}
        selectedCourseId={courseId}
        onSelectCourse={(id) => {
          navigateToCourse(id);
        }}
        onComplete={(nextAccount) => {
          if (nextAccount) setAccount(nextAccount);
          localStorage.setItem("pathway-onboarding-complete", "true");
          setOnboarding(false);
        }}
      />
    );
  const hasPassed = result?.passed === true;
  const orderedLessons = course.modules
    .flatMap((module) => module.lessons)
    .sort((a, b) => a.order - b.order);
  const available = new Set(
    course.languageId === "claude"
      ? orderedLessons.map((item) => item.slug)
      : orderedLessons
          .filter(
            (item, index) =>
              index === 0 || completed.includes(orderedLessons[index - 1].slug),
          )
          .map((item) => item.slug),
  );
  const currentLessonIndex = orderedLessons.findIndex(
    (item) => item.slug === lesson.slug,
  );
  const previousLessonSlug =
    currentLessonIndex > 0 ? orderedLessons[currentLessonIndex - 1].slug : null;
  const logout = () => {
    setCompleted(readProgress(`guest:${learnerId}`));
    setAccount(null);
    void logoutFromKeycloak();
  };
  if (
    workspace === "dashboard" ||
    workspace === "projects" ||
    workspace === "community" ||
    workspace === "coach"
  )
    return (
      <div className="app-dark min-h-screen bg-canvas lg:flex">
        <Sidebar
          course={course}
          current={lesson.slug}
          completed={completed}
          available={available}
          workspace={workspace}
          onNavigate={setWorkspace}
          onChangeCourse={(id) => {
            navigateToCourse(id);
          }}
          onSelect={loadLesson}
          onLocked={() =>
            notify("Complete the previous lesson to unlock this one.")
          }
        />
        <main className="min-w-0 flex-1">
          <header className="top-shell flex h-[70px] items-center justify-between border-b border-[#3b3052] bg-[#0f0d17] px-6 sm:px-10">
            <p className="text-sm text-[#bdb2cf]">
              ‹{" "}
              <span>
                {
                  {
                    dashboard: "Progress dashboard",
                    projects: "Project studio",
                    community: "Community",
                    coach: "Guided coach",
                  }[workspace]
                }
              </span>
            </p>
            <div className="flex items-center gap-3">
              {donationUrl && (
                <a
                  href={donationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hidden rounded-md bg-pine px-3 py-2 text-xs font-bold text-white sm:block"
                >
                  Support Pathway
                </a>
              )}
              {account ? (
                <ProfileMenu account={account} onLogout={logout} />
              ) : (
                <button
                  onClick={() => void loginWithKeycloak(false)}
                  className="hidden rounded-md border border-[#7652a6] px-3 py-1.5 text-xs font-semibold text-[#e2d3ff] hover:bg-[#7a43c52b] sm:block"
                >
                  Sign in
                </button>
              )}
              <button
                onClick={() => notify("No new notifications.")}
                className="relative text-[#bdb2cf]"
                aria-label="Notifications"
              >
                <Bell size={19} />
                <i className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-[#e86f49]" />
              </button>
            </div>
          </header>
          <ExperienceHub
            view={workspace}
            course={course}
            completed={completed}
            onSelectLesson={(slug) => {
              setWorkspace("learn");
              void loadLesson(slug);
            }}
            onNotice={notify}
          />
        </main>
        <div
          className={`app-toast fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-md bg-[#26342d] px-4 py-2.5 text-xs text-white transition ${toast ? "opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}
        >
          {toast}
        </div>
      </div>
    );
  return (
    <div className="app-dark min-h-screen bg-canvas lg:flex">
      <Sidebar
        course={course}
        current={lesson.slug}
        completed={completed}
        available={available}
        workspace={workspace}
        onNavigate={setWorkspace}
        onChangeCourse={(id) => {
          navigateToCourse(id);
          setWorkspace("learn");
        }}
        onSelect={loadLesson}
        onLocked={() =>
          notify("Complete the previous lesson to unlock this one.")
        }
      />
      <main className="min-w-0 flex-1">
        <header className="top-shell flex h-[70px] items-center justify-between border-b border-[#e4e1d8] bg-[#faf8f2] px-6 sm:px-10">
          <p className="text-sm text-[#70766f]">
            ‹{" "}
            <span>
              {workspace === "learn"
                ? lesson.module
                : workspace === "practice"
                  ? "Practice"
                  : "Projects"}
            </span>
          </p>
          <div className="flex items-center gap-3">
            <a
              href={lesson.version.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden text-xs text-[#70766f] sm:block"
            >
              {lesson.version.language} · {lesson.version.framework}
            </a>
            {donationUrl && (
              <a
                href={donationUrl}
                target="_blank"
                rel="noreferrer"
                className="hidden rounded-md bg-pine px-3 py-2 text-xs font-bold text-white sm:block"
              >
                Support Pathway
              </a>
            )}
            {account ? (
              <ProfileMenu account={account} onLogout={logout} />
            ) : (
              <button
                onClick={() => void loginWithKeycloak(false)}
                className="hidden rounded-md border border-[#7652a6] px-3 py-1.5 text-xs font-semibold text-[#e2d3ff] hover:bg-[#7a43c52b] sm:block"
              >
                Sign in
              </button>
            )}
            <button
              onClick={() => notify("No new notifications.")}
              className="relative text-[#70766f]"
              aria-label="Notifications"
            >
              <Bell size={19} />
              <i className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-[#e86f49]" />
            </button>
          </div>
        </header>
        {workspace === "learn" ? (
          <section className="mx-auto grid min-h-[calc(100vh-70px)] max-w-[1600px] grid-cols-1 lg:grid-cols-[48%_52%]">
            <LessonContent lesson={lesson} />
            {lesson.exercise.kind === "Presentation" ? (
              <PresentationPanel
                lesson={lesson}
                canGoBack={previousLessonSlug !== null}
                onBack={() => previousLessonSlug && loadLesson(previousLessonSlug)}
                onNext={() => lesson.nextSlug && loadLesson(lesson.nextSlug)}
              />
            ) : (
              <ExercisePanel
                lesson={lesson}
                answer={answer}
                setAnswer={setAnswer}
                unit={unit}
                setUnit={setUnit}
                meterMode={meterMode}
                setMeterMode={setMeterMode}
                redProbe={redProbe}
                setRedProbe={setRedProbe}
                blackProbe={blackProbe}
                setBlackProbe={setBlackProbe}
                diagnosis={diagnosis}
                setDiagnosis={setDiagnosis}
                code={code}
                setCode={setCode}
                result={result}
                passed={hasPassed}
                submit={submit}
                onReset={() => setCode(lesson.exercise.starterCode ?? "")}
                onNext={() => lesson.nextSlug && loadLesson(lesson.nextSlug)}
              />
            )}
          </section>
        ) : (
          <WorkspacePanel
            workspace={workspace}
            course={course}
            completed={completed}
            available={available}
            onLearn={() => setWorkspace("learn")}
            onSelect={(slug) => {
              setWorkspace("learn");
              void loadLesson(slug);
            }}
            onLocked={() =>
              notify("Complete the previous lesson to unlock this one.")
            }
          />
        )}
      </main>
      <div
        className={`app-toast fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-md bg-[#26342d] px-4 py-2.5 text-xs text-white transition ${toast ? "opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}
      >
        {toast}
      </div>
    </div>
  );
}

function Onboarding({
  course,
  selectedCourseId,
  onSelectCourse,
  onComplete,
}: {
  course: Course;
  selectedCourseId: string;
  onSelectCourse: (courseId: string) => void;
  onComplete: (account: Account | null) => void;
}) {
  const [mode, setMode] = useState<"welcome" | "register" | "login">("welcome");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const authenticate = async () => {
    setError("");
    setSubmitting(true);
    try {
      if (!keycloakConfigured)
        throw new Error(
          "Keycloak is not configured yet. Add the VITE_KEYCLOAK_URL, VITE_KEYCLOAK_REALM, and VITE_KEYCLOAK_CLIENT_ID variables.",
        );
      localStorage.setItem("pathway-onboarding-complete", "true");
      await loginWithKeycloak(mode === "register");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Something went wrong.",
      );
      setSubmitting(false);
    }
  };
  const computingSelected = selectedCourseId === "computing-foundations";
  const electricalSelected = selectedCourseId === "electrical-engineering-foundations";
  const gitSelected = selectedCourseId === "git-cli";
  const webBasicsSelected = selectedCourseId === "web-development-basics";
  const reactLiteSelected = selectedCourseId === "react-lite";
  const reactSelected = selectedCourseId === "react-enterprise";
  const pythonSelected = selectedCourseId === "python-web";
  const rustSelected = selectedCourseId === "rust-systems";
  const csharpSelected = selectedCourseId === "csharp-dotnet";
  const claudeSelected = selectedCourseId === "claude-engineering";
  return (
    <main className="onboarding app-dark grid min-h-screen place-items-center overflow-x-hidden px-5 py-10">
      <div className="onboarding-grid" />
      <section className="relative z-10 w-full max-w-[960px]">
        <div className="mb-12 flex items-center justify-between">
          <div className="flex items-center gap-2 font-display text-2xl font-bold tracking-[-1px]">
            <span className="brand-orbit text-3xl">⌁</span>pathway
          </div>
          <span className="rounded-full border border-[#9860ef55] bg-[#8d4be214] px-3 py-1 text-[10px] font-bold tracking-[1.4px] text-[#c9a6ff]">
            YOUR LEARNING PATH
          </span>
        </div>
        {mode === "welcome" ? (
          <div className="grid gap-12 lg:grid-cols-[1.05fr_.95fr] lg:items-end">
            <div>
              <p className="mb-5 text-xs font-bold tracking-[2px] text-[#b77dff]">
                LEARN WITH INTENTION
              </p>
              <h1 className="max-w-[620px] font-display text-5xl font-bold leading-[.98] tracking-[-3px] text-white sm:text-7xl">
                Build the skills
                <br />
                that <span className="neon-text">compound.</span>
              </h1>
              <p className="mt-7 max-w-[480px] text-base leading-relaxed text-[#aaa3b6]">
                Guided technical courses that build durable mental models, practical
                judgment, and skills you can carry into deeper engineering work.
              </p>
            </div>
            <div className="onboarding-card rounded-2xl p-6 sm:p-8">
              <p className="text-[10px] font-bold tracking-[1.5px] text-[#ad7cf4]">
                CHOOSE YOUR FIRST TRACK
              </p>
              <button
                onClick={() => onSelectCourse("computing-foundations")}
                className={`track-option mt-5 flex w-full items-center gap-4 rounded-xl p-4 text-left ${computingSelected ? "ring-1 ring-[#bd87ff]" : ""}`}
              >
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-[#4f7b69] font-mono text-sm font-bold text-white">
                  01
                </span>
                <span>
                  <strong className="block text-sm text-white">
                    Computing Foundations
                  </strong>
                  <small className="mt-1 block text-xs text-[#aaa3b6]">
                    Machine · data · processes · operating systems
                  </small>
                </span>
                {computingSelected && (
                  <Check className="ml-auto text-[#c198ff]" size={19} />
                )}
              </button>
              <button
                onClick={() => onSelectCourse("electrical-engineering-foundations")}
                className={`track-option mt-3 flex w-full items-center gap-4 rounded-xl p-4 text-left ${electricalSelected ? "ring-1 ring-[#bd87ff]" : ""}`}
              >
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-[#c9772d] font-mono text-sm font-bold text-white">EE</span>
                <span>
                  <strong className="block text-sm text-white">Electrical Engineering Foundations</strong>
                  <small className="mt-1 block text-xs text-[#aaa3b6]">Circuits · measurement · components · signals</small>
                </span>
                {electricalSelected && <Check className="ml-auto text-[#c198ff]" size={19} />}
              </button>
              <button
                onClick={() => onSelectCourse("git-cli")}
                className={`track-option mt-3 flex w-full items-center gap-4 rounded-xl p-4 text-left ${gitSelected ? "ring-1 ring-[#bd87ff]" : ""}`}
              >
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-[#f05032] font-mono text-sm font-bold text-white">
                  Git
                </span>
                <span>
                  <strong className="block text-sm text-white">Git CLI</strong>
                  <small className="mt-1 block text-xs text-[#aaa3b6]">
                    Repositories · branches · remotes · recovery
                  </small>
                </span>
                {gitSelected && <Check className="ml-auto text-[#c198ff]" size={19} />}
              </button>
              <button
                onClick={() => onSelectCourse("web-development-basics")}
                className={`track-option mt-3 flex w-full items-center gap-4 rounded-xl p-4 text-left ${webBasicsSelected ? "ring-1 ring-[#bd87ff]" : ""}`}
              >
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-[#46658a] font-mono text-xs font-bold text-white">WEB</span>
                <span>
                  <strong className="block text-sm text-white">Web Development Basics 2026</strong>
                  <small className="mt-1 block text-xs text-[#aaa3b6]">HTML · CSS · JavaScript · TypeScript · HTTP</small>
                </span>
                {webBasicsSelected && <Check className="ml-auto text-[#c198ff]" size={19} />}
              </button>
              <button
                onClick={() => onSelectCourse("react-lite")}
                className={`track-option mt-3 flex w-full items-center gap-4 rounded-xl p-4 text-left ${reactLiteSelected ? "ring-1 ring-[#bd87ff]" : ""}`}
              >
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-[#149eca] font-mono text-xs font-bold text-white">⚛L</span>
                <span>
                  <strong className="block text-sm text-white">React Lite 2026</strong>
                  <small className="mt-1 block text-xs text-[#aaa3b6]">Build your first functional admin dashboard</small>
                </span>
                {reactLiteSelected && <Check className="ml-auto text-[#c198ff]" size={19} />}
              </button>
              <button
                onClick={() => onSelectCourse("react-enterprise")}
                className={`track-option mt-3 flex w-full items-center gap-4 rounded-xl p-4 text-left ${reactSelected ? "ring-1 ring-[#bd87ff]" : ""}`}
              >
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-[#149eca] font-mono text-sm font-bold text-white">
                  ⚛
                </span>
                <span>
                  <strong className="block text-sm text-white">React 2026: enterprise applications</strong>
                  <small className="mt-1 block text-xs text-[#aaa3b6]">
                    React 19.3 · TypeScript 6 · Router 8 · Tailwind 4
                  </small>
                </span>
                {reactSelected && <Check className="ml-auto text-[#c198ff]" size={19} />}
              </button>
              <button
                onClick={() => onSelectCourse("csharp-dotnet")}
                className={`track-option mt-3 flex w-full items-center gap-4 rounded-xl p-4 text-left ${csharpSelected ? "ring-1 ring-[#bd87ff]" : ""}`}
              >
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-[#a567ff] font-mono text-sm font-bold text-white shadow-lg shadow-[#8d4cff55]">
                  C#
                </span>
                <span>
                  <strong className="block text-sm text-white">
                    C# / .NET: zero to staff
                  </strong>
                  <small className="mt-1 block text-xs text-[#aaa3b6]">
                    C# 14 · .NET 10
                  </small>
                </span>
                {csharpSelected && (
                  <Check className="ml-auto text-[#c198ff]" size={19} />
                )}
              </button>
              <button
                onClick={() => onSelectCourse("python-web")}
                className={`track-option mt-3 flex w-full items-center gap-4 rounded-xl p-4 text-left ${pythonSelected ? "ring-1 ring-[#bd87ff]" : ""}`}
              >
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-[#3776ab] font-mono text-sm font-bold text-white">
                  Py
                </span>
                <span>
                  <strong className="block text-sm text-white">
                    Python Web: zero to staff
                  </strong>
                  <small className="mt-1 block text-xs text-[#aaa3b6]">
                    Python 3.14 · FastAPI · Flask · Django
                  </small>
                </span>
                {pythonSelected && (
                  <Check className="ml-auto text-[#c198ff]" size={19} />
                )}
              </button>
              <button
                onClick={() => onSelectCourse("rust-systems")}
                className={`track-option mt-3 flex w-full items-center gap-4 rounded-xl p-4 text-left ${rustSelected ? "ring-1 ring-[#bd87ff]" : ""}`}
              >
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-[#dea584] font-mono text-sm font-bold text-[#2b1d16]">
                  Rs
                </span>
                <span>
                  <strong className="block text-sm text-white">
                    Rust Systems: zero to staff
                  </strong>
                  <small className="mt-1 block text-xs text-[#aaa3b6]">
                    Rust 1.97 · Tokio · Axum
                  </small>
                </span>
                {rustSelected && (
                  <Check className="ml-auto text-[#c198ff]" size={19} />
                )}
              </button>
              <button
                onClick={() => onSelectCourse("claude-engineering")}
                className={`track-option mt-3 flex w-full items-center gap-4 rounded-xl p-4 text-left ${claudeSelected ? "ring-1 ring-[#bd87ff]" : ""}`}
              >
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-[#d97757] font-mono text-sm font-bold text-white">
                  AI
                </span>
                <span>
                  <strong className="block text-sm text-white">
                    Claude Engineering: Hooks
                  </strong>
                  <small className="mt-1 block text-xs text-[#aaa3b6]">
                    Claude Code · lifecycle automation
                  </small>
                </span>
                {claudeSelected && (
                  <Check className="ml-auto text-[#c198ff]" size={19} />
                )}
              </button>
              <div className="mt-5 border-t border-[#ffffff12] pt-4">
                <p className="text-[10px] font-bold tracking-[1.4px] text-[#7f768c]">
                  COMING SOON
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    ["Networking Fundamentals", "Packets · IP · routing · ports"],
                    ["DNS", "Names · records · resolvers · caching"],
                    ["HTTP & APIs", "Methods · status · headers · contracts"],
                    ["HTTPS & TLS", "Certificates · encryption · trust"],
                    ["Distributed Systems", "Latency · failure · retries · idempotency"],
                    ["Digital Electronics", "Logic · timing · state"],
                    ["Analog Electronics", "Amplifiers · filters · feedback"],
                    ["AC Circuit Analysis", "Phasors · impedance · resonance"],
                    ["Embedded Systems", "Firmware · peripherals · integration"],
                    ["Microcontrollers", "GPIO · timers · ADC · buses"],
                    ["PCB Design", "Schematic · layout · fabrication"],
                    ["Signals & Systems", "Signals · systems · transforms"],
                    ["Control Systems", "Feedback · stability · control"],
                    ["Electromagnetics", "Fields · waves · transmission"],
                    ["Power Electronics", "Converters · switching · magnetics"],
                  ].map(([title, subtitle]) => (
                    <div
                      key={title}
                      className="rounded-lg border border-[#ffffff0d] bg-[#ffffff05] px-3 py-2.5 opacity-70"
                    >
                      <strong className="block text-xs text-[#d4ccd9]">{title}</strong>
                      <small className="mt-1 block text-[10px] leading-relaxed text-[#8f8799]">
                        {subtitle}
                      </small>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-4 text-xs text-[#aaa3b6]">
                Selected: {course.title}
              </p>
              <button
                onClick={() => onComplete(null)}
                className="onboarding-cta mt-6 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-sm font-bold text-white"
              >
                Continue as guest <ArrowRight size={17} />
              </button>
              <p className="mt-2 text-center text-[10px] leading-relaxed text-[#857d91]">
                No account required. Progress stays on this browser.
              </p>
              <button
                onClick={() => setMode("register")}
                className="mt-4 w-full rounded-lg border border-[#7652a6] px-4 py-3 text-xs font-bold text-[#d8c5f3] hover:bg-[#ffffff08] hover:text-white"
              >
                Create free account
              </button>
              <button
                onClick={() => setMode("login")}
                className="mt-3 w-full text-xs text-[#bcb5c9] hover:text-white"
              >
                Already have an account?{" "}
                <span className="text-[#bc88ff]">Sign in</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[440px] onboarding-card rounded-2xl p-7 sm:p-9">
            <button
              onClick={() => setMode("welcome")}
              className="mb-6 text-xs text-[#a39bad] hover:text-white"
            >
              ← Back
            </button>
            <div className="mb-7 flex h-11 w-11 items-center justify-center rounded-xl bg-[#9353ef2c] text-[#c395ff]">
              <LogIn size={20} />
            </div>
            <h1 className="font-display text-3xl font-bold tracking-[-1.5px] text-white">
              {mode === "login" ? "Welcome back." : "Make it yours."}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#a9a2b7]">
              {mode === "login"
                ? "Sign in to continue your learning path."
                : "Your progress syncs securely across devices."}
            </p>
            <div className="mt-7 grid gap-4">
              {mode === "register" && (
                <label className="grid gap-1.5 text-xs font-semibold text-[#c5bdd2]">
                  Name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    placeholder="Ada Lovelace"
                    className="onboarding-input rounded-lg px-3 py-3 text-sm outline-none"
                  />
                </label>
              )}
              <label className="grid gap-1.5 text-xs font-semibold text-[#c5bdd2]">
                Email
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="onboarding-input rounded-lg px-3 py-3 text-sm outline-none"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-[#c5bdd2]">
                Password
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  placeholder="At least 10 characters"
                  className="onboarding-input rounded-lg px-3 py-3 text-sm outline-none"
                />
              </label>
              {error && (
                <p className="rounded-lg border border-[#ff659655] bg-[#ff4d8215] px-3 py-2 text-xs text-[#ffb3cc]">
                  {error}
                </p>
              )}
              <button
                disabled={submitting}
                onClick={authenticate}
                className="onboarding-cta mt-2 rounded-lg px-4 py-3.5 text-sm font-bold text-white disabled:opacity-60"
              >
                {submitting
                  ? "One moment…"
                  : mode === "login"
                    ? "Sign in"
                    : "Create account"}
              </button>
            </div>
            <button
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              className="mt-5 w-full text-xs text-[#aaa3b6]"
            >
              {mode === "login" ? "New here? " : "Already have an account? "}
              <span className="text-[#c193ff]">
                {mode === "login" ? "Create one" : "Sign in"}
              </span>
            </button>
            <div className="mt-5 border-t border-[#ffffff12] pt-5">
              <button
                onClick={() => onComplete(null)}
                className="w-full rounded-lg border border-[#ffffff18] px-4 py-3 text-xs font-bold text-[#c7bfce] hover:bg-[#ffffff08] hover:text-white"
              >
                Continue as guest instead
              </button>
              <p className="mt-2 text-center text-[10px] text-[#777080]">
                No account required. Guest progress stays on this browser.
              </p>
            </div>
          </div>
        )}
      </section>
      <footer className="relative z-10 mt-8 flex justify-center gap-4 text-[11px] text-[#8b809a]">
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
        <a href="/support.html">Support</a>
      </footer>
    </main>
  );
}

function ProfileMenu({
  account,
  onLogout,
}: {
  account: Account;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const initial = account.displayName.trim().slice(0, 1).toUpperCase();
  return (
    <div className="relative hidden sm:block">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-[#7652a6] bg-[#241839] px-2 py-1.5 text-xs font-semibold text-[#f0e7ff] hover:bg-[#32204d]"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[#a970ff] text-[10px] text-white">
          {initial}
        </span>
        <span className="max-w-28 truncate">{account.displayName}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="profile-menu absolute right-0 top-11 z-30 w-64 rounded-xl border p-2 shadow-2xl"
        >
          <div className="border-b border-[#3d3155] px-3 py-2.5">
            <p className="m-0 text-sm font-semibold text-white">
              {account.displayName}
            </p>
            <p className="mt-1 truncate text-xs text-[#bdb2cf]">
              {account.email || "Signed-in learner"}
            </p>
          </div>
          <button
            role="menuitem"
            onClick={onLogout}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-[#ffd3e6] hover:bg-[#ff5f9718]"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function ThemePicker() {
  const [accent, setAccent] = useState(
    () => localStorage.getItem("pathway-accent") ?? "purple",
  );
  useEffect(() => {
    applyAccent(accent);
    localStorage.setItem("pathway-accent", accent);
  }, [accent]);
  return (
    <div className="mt-4 border-t border-[#332846] pt-4">
      <p className="text-[9px] font-bold tracking-[1px] text-[#9688ae]">
        PRIMARY COLOR
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {accentOptions.map((option) => (
          <button
            key={option.id}
            onClick={() => setAccent(option.id)}
            aria-label={`${option.label} theme`}
            aria-pressed={accent === option.id}
            className={`grid h-5 w-5 place-items-center rounded-full border-2 ${accent === option.id ? "border-white" : "border-transparent"}`}
            style={{ background: option.value }}
          >
            <span className="sr-only">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Sidebar({
  course,
  current,
  completed,
  available,
  workspace,
  onNavigate,
  onChangeCourse,
  onSelect,
  onLocked,
}: {
  course: Course;
  current: string;
  completed: string[];
  available: Set<string>;
  workspace: Workspace;
  onNavigate: (workspace: Workspace) => void;
  onChangeCourse: (courseId: string) => void;
  onSelect: (slug: string) => void;
  onLocked: () => void;
}) {
  const [trackMenuOpen, setTrackMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("pathway-sidebar-collapsed") === "true",
  );
  const setSidebarCollapsed = (next: boolean) => {
    setCollapsed(next);
    setTrackMenuOpen(false);
    localStorage.setItem("pathway-sidebar-collapsed", String(next));
  };
  const languageBadge =
    course.languageId === "python"
      ? "Py"
      : course.languageId === "rust"
        ? "Rs"
        : course.languageId === "claude"
          ? "AI"
          : course.languageId === "computing"
            ? "01"
            : course.languageId === "electrical-engineering"
              ? "EE"
              : "C#";
  const nav = (id: Workspace, label: string, icon: ReactNode) => (
    <button
      onClick={() => onNavigate(id)}
      aria-current={workspace === id ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={`flex items-center rounded-lg py-2.5 text-left transition ${collapsed ? "justify-center px-2" : "gap-3 px-3"} ${workspace === id ? "bg-[#6d36ce42] font-bold text-white" : "text-[#bdb2cf] hover:bg-[#ffffff0b] hover:text-white"}`}
    >
      {icon}
      {!collapsed && label}
    </button>
  );
  return (
    <aside className={`sidebar-shell relative hidden min-h-screen shrink-0 flex-col border-r border-[#332846] bg-[#0f0d17] py-7 text-[#eee6fa] transition-[width,padding] duration-200 lg:flex ${collapsed ? "w-[76px] px-3" : "w-[264px] px-4"}`}>
      <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between px-3"}`}>
        <div className={`flex items-center font-display font-semibold text-white ${collapsed ? "" : "gap-2 text-[27px] tracking-[-1.4px]"}`}>
          <span className="brand-orbit font-sans text-[33px] leading-5 text-[#b981ff]">
            ⌁
          </span>
          {!collapsed && <span>pathway</span>}
        </div>
        <button
          onClick={() => setSidebarCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#9688ae] hover:bg-[#ffffff0b] hover:text-white ${collapsed ? "absolute left-[62px] top-7 border border-[#332846] bg-[#0f0d17]" : ""}`}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      <nav className={`grid gap-1 text-sm font-medium ${collapsed ? "mt-10" : "mt-11"}`}>
        {nav("learn", "Learn", <Code2 size={17} />)}
        {nav(
          "practice",
          "Practice",
          <span className="text-lg leading-4">◌</span>,
        )}
        {nav(
          "dashboard",
          "Progress",
          <span className="text-lg leading-4">◔</span>,
        )}
        {nav("projects", "Projects", <FolderKanban size={17} />)}
        {nav("coach", "Coach", <Sparkles size={17} />)}
        {nav("community", "Community", <UserRound size={17} />)}
      </nav>
      {!collapsed && (
        <>
      <p className="mb-2 mt-8 px-3 text-[10px] font-bold tracking-[1.15px] text-[#9688ae]">
        YOUR TRACK
      </p>
      <div className="relative">
        <button
          onClick={() => setTrackMenuOpen((open) => !open)}
          aria-expanded={trackMenuOpen}
          aria-haspopup="menu"
          className="flex w-full items-center gap-2 rounded-md px-3 pb-4 text-left text-sm font-semibold hover:bg-[#ffffff0b]"
        >
          <span className="language-badge rounded bg-[#785aa8] px-1 py-0.5 text-[9px] text-white">
            {languageBadge}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {course.languageVersion} / {course.frameworkVersion}
          </span>
          <ChevronDown
            className={
              trackMenuOpen
                ? "shrink-0 rotate-180 transition"
                : "shrink-0 transition"
            }
            size={15}
          />
        </button>
        {trackMenuOpen ? (
          <TrackMenu
            courseId={course.id}
            close={() => setTrackMenuOpen(false)}
            onChangeCourse={onChangeCourse}
          />
        ) : null}
      </div>
      <div className="border-t border-[#332846] pt-2">
        {workspace === "learn" &&
          course.modules.map((module) => (
            <div key={module.title}>
              <p className="px-2.5 pt-3 text-[9px] font-bold tracking-[1px] text-[#9688ae]">
                {module.title.toUpperCase()}
              </p>
              {module.lessons.map((item) => {
                const active = item.slug === current,
                  done = completed.includes(item.slug),
                  unlocked = available.has(item.slug);
                return (
                  <button
                    onClick={() =>
                      unlocked ? onSelect(item.slug) : onLocked()
                    }
                    key={item.slug}
                    aria-label={unlocked ? item.title : `${item.title} locked`}
                    className={`lesson-nav flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left text-[13px] ${active ? "bg-[#ffffff12] font-bold text-white" : unlocked ? "font-medium text-[#c2b8d2] hover:bg-[#ffffff0b]" : "text-[#6d647a]"}`}
                  >
                    <span
                      className={`grid h-[19px] w-[19px] place-items-center rounded-full border text-[10px] ${done ? "border-[#a970ff] bg-[#8d4be2] text-white" : active ? "border-[5px] border-[#b981ff]" : unlocked ? "border-[#786b8f]" : "border-[#493f55]"}`}
                    >
                      {done ? (
                        <Check size={11} />
                      ) : !unlocked ? (
                        <LockKeyhole size={9} />
                      ) : null}
                    </span>
                    {item.title}
                  </button>
                );
              })}
            </div>
          ))}
      </div>
      <div className="mt-auto border-t border-[#332846] px-3 py-4">
        <div className="flex gap-3">
          <Flame className="text-[#ff9270]" />
          <div>
            <strong className="block text-xs text-white">Learning path</strong>
            <small className="block pt-1 text-[11px] text-[#a99dbd]">
              {
                completed.filter((slug) =>
                  course.modules.some((module) =>
                    module.lessons.some((lesson) => lesson.slug === slug),
                  ),
                ).length
              }{" "}
              lessons completed
            </small>
          </div>
        </div>
        <ThemePicker />
        {donationUrl && (
          <a
            href={donationUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 block rounded-lg border border-[#7652a6] bg-[#8d4be21c] px-3 py-2 text-center text-xs font-bold text-[#e6d8ff] hover:bg-[#8d4be238]"
          >
            Support Pathway →
          </a>
        )}
        <div className="mt-4 flex gap-3 text-[10px] text-[#9589a6]">
          <a href="/privacy.html" className="hover:text-white">
            Privacy
          </a>
          <a href="/terms.html" className="hover:text-white">
            Terms
          </a>
          <a href="/support.html" className="hover:text-white">
            Support
          </a>
        </div>
      </div>
        </>
      )}
    </aside>
  );
}

function TrackMenu({
  courseId,
  close,
  onChangeCourse,
}: {
  courseId: string;
  close: () => void;
  onChangeCourse: (courseId: string) => void;
}) {
  const select = (id: string) => {
    close();
    onChangeCourse(id);
  };
  const itemClass = (id: string) =>
    `flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-xs ${courseId === id ? "bg-[#6d36ce42] font-bold text-white" : "text-[#d5cae4] hover:bg-[#ffffff0b]"}`;
  return (
    <div
      role="menu"
      className="absolute z-20 w-full rounded-md border border-[#4b3a67] bg-[#21182f] p-1 shadow-xl"
    >
      <button
        role="menuitem"
        onClick={() => select("computing-foundations")}
        className={itemClass("computing-foundations")}
      >
        <span className="rounded bg-[#4f7b69] px-1 py-0.5 text-[9px] text-white">
          01
        </span>
        <span>Computing Foundations</span>
        {courseId === "computing-foundations" && (
          <Check className="ml-auto" size={14} />
        )}
      </button>
      <button
        role="menuitem"
        onClick={() => select("electrical-engineering-foundations")}
        className={itemClass("electrical-engineering-foundations")}
      >
        <span className="rounded bg-[#c9772d] px-1 py-0.5 text-[9px] text-white">EE</span>
        <span>Electrical Engineering</span>
        {courseId === "electrical-engineering-foundations" && <Check className="ml-auto" size={14} />}
      </button>
      <button
        role="menuitem"
        onClick={() => select("git-cli")}
        className={itemClass("git-cli")}
      >
        <span className="rounded bg-[#f05032] px-1 py-0.5 text-[9px] text-white">Git</span>
        <span>Git CLI</span>
        {courseId === "git-cli" && <Check className="ml-auto" size={14} />}
      </button>
      <button
        role="menuitem"
        onClick={() => select("web-development-basics")}
        className={itemClass("web-development-basics")}
      >
        <span className="rounded bg-[#46658a] px-1 py-0.5 text-[9px] text-white">WEB</span>
        <span>Web Development Basics</span>
        {courseId === "web-development-basics" && <Check className="ml-auto" size={14} />}
      </button>
      <button
        role="menuitem"
        onClick={() => select("react-lite")}
        className={itemClass("react-lite")}
      >
        <span className="rounded bg-[#149eca] px-1 py-0.5 text-[9px] text-white">⚛L</span>
        <span>React Lite 2026</span>
        {courseId === "react-lite" && <Check className="ml-auto" size={14} />}
      </button>
      <button
        role="menuitem"
        onClick={() => select("react-enterprise")}
        className={itemClass("react-enterprise")}
      >
        <span className="rounded bg-[#149eca] px-1 py-0.5 text-[9px] text-white">⚛</span>
        <span>React 2026</span>
        {courseId === "react-enterprise" && <Check className="ml-auto" size={14} />}
      </button>
      <button
        role="menuitem"
        onClick={() => select("csharp-dotnet")}
        className={itemClass("csharp-dotnet")}
      >
        <span className="rounded bg-[#785aa8] px-1 py-0.5 text-[9px] text-white">
          C#
        </span>
        <span>C# / .NET</span>
        {courseId === "csharp-dotnet" && (
          <Check className="ml-auto" size={14} />
        )}
      </button>
      <button
        role="menuitem"
        onClick={() => select("python-web")}
        className={itemClass("python-web")}
      >
        <span className="rounded bg-[#3776ab] px-1 py-0.5 text-[9px] text-white">
          Py
        </span>
        <span>Python Web</span>
        {courseId === "python-web" && <Check className="ml-auto" size={14} />}
      </button>
      <button
        role="menuitem"
        onClick={() => select("rust-systems")}
        className={itemClass("rust-systems")}
      >
        <span className="rounded bg-[#dea584] px-1 py-0.5 text-[9px] text-[#2b1d16]">
          Rs
        </span>
        <span>Rust Systems</span>
        {courseId === "rust-systems" && <Check className="ml-auto" size={14} />}
      </button>
      <button
        role="menuitem"
        onClick={() => select("claude-engineering")}
        className={itemClass("claude-engineering")}
      >
        <span className="rounded bg-[#d97757] px-1 py-0.5 text-[9px] text-white">
          AI
        </span>
        <span>Claude Engineering</span>
        {courseId === "claude-engineering" && (
          <Check className="ml-auto" size={14} />
        )}
      </button>
      <div className="my-1 border-t border-[#ffffff10]" />
      {["Networking", "DNS", "HTTP & APIs", "HTTPS & TLS", "Distributed Systems", "Digital Electronics", "Analog Electronics", "AC Circuit Analysis", "Embedded Systems", "Microcontrollers", "PCB Design", "Signals & Systems", "Control Systems", "Electromagnetics", "Power Electronics"].map((title) => (
        <div
          key={title}
          className="flex items-center justify-between rounded px-3 py-2 text-[11px] text-[#786f86]"
        >
          <span>{title}</span>
          <span className="text-[9px] font-bold uppercase tracking-[.8px]">Soon</span>
        </div>
      ))}
    </div>
  );
}

function WorkspacePanel({
  workspace,
  course,
  completed,
  available,
  onLearn,
  onSelect,
  onLocked,
}: {
  workspace: Exclude<Workspace, "learn">;
  course: Course;
  completed: string[];
  available: Set<string>;
  onLearn: () => void;
  onSelect: (slug: string) => void;
  onLocked: () => void;
}) {
  const lessons = course.modules
    .flatMap((module) => module.lessons)
    .sort((a, b) => a.order - b.order);
  if (workspace === "practice") {
    const reviewLessons = lessons.filter((item) =>
      completed.includes(item.slug),
    );
    const nextLesson = lessons.find(
      (item) => available.has(item.slug) && !completed.includes(item.slug),
    );
    return (
      <section className="mx-auto w-full max-w-4xl px-7 py-12 sm:px-12">
        <p className="text-[10px] font-bold tracking-[1.4px] text-[#5d886f]">
          PRACTICE STUDIO
        </p>
        <h1 className="mt-2 font-display text-5xl font-semibold tracking-[-2px] text-forest">
          Strengthen the signal.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[#59635c]">
          Return to completed lessons for deliberate review, or continue with
          the next unlocked challenge in your current track.
        </p>
        <div className="mt-9 grid gap-4 sm:grid-cols-2">
          <button
            onClick={() => (nextLesson ? onSelect(nextLesson.slug) : onLearn())}
            className="rounded-xl bg-pine p-5 text-left text-white shadow-sm"
          >
            <span className="text-[10px] font-bold tracking-[1.3px] text-[#bce9d8]">
              NEXT CHALLENGE
            </span>
            <strong className="mt-2 block text-lg">
              {nextLesson?.title ?? "Track complete — review your work"}
            </strong>
            <span className="mt-4 inline-block text-xs text-[#d8efe5]">
              Open lesson →
            </span>
          </button>
          <div className="rounded-xl border border-[#dfddd4] bg-[#fffefa] p-5">
            <span className="text-[10px] font-bold tracking-[1.3px] text-[#6e786f]">
              PROGRESS
            </span>
            <strong className="mt-2 block font-display text-3xl text-forest">
              {
                completed.filter((slug) =>
                  lessons.some((lesson) => lesson.slug === slug),
                ).length
              }{" "}
              / {lessons.length}
            </strong>
            <span className="mt-2 block text-xs text-[#70766f]">
              Lessons completed in this track
            </span>
          </div>
        </div>
        <h2 className="mt-11 font-display text-2xl font-semibold text-forest">
          Review queue
        </h2>
        <div className="mt-4 grid gap-2">
          {reviewLessons.length ? (
            reviewLessons.map((item) => (
              <button
                key={item.slug}
                onClick={() => onSelect(item.slug)}
                className="flex items-center justify-between rounded-lg border border-[#dfddd4] bg-[#fffefa] px-4 py-3 text-left text-sm text-[#3b4940] hover:border-[#75a991]"
              >
                <span>
                  <Check className="mr-2 inline text-[#278164]" size={15} />
                  {item.title}
                </span>
                <span className="text-xs text-[#4d8a70]">Practice again →</span>
              </button>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-[#d5d2c9] p-5 text-sm text-[#70766f]">
              Complete a lesson and it will appear here for review.
            </div>
          )}
        </div>
      </section>
    );
  }
  const stages =
    course.id === "web-development-basics"
      ? [
          [
            "Web page foundations",
            "Build semantic HTML, responsive CSS, and JavaScript interactions without hiding the browser fundamentals behind a framework.",
          ],
          [
            "API-shaped interaction",
            "Practice HTTP/JSON, fetch, async behavior, browser DevTools, and accessible form behavior.",
          ],
          [
            "Web basics capstone",
            "Trace a small users feature from markup and layout through JavaScript behavior and an API-shaped data flow.",
          ],
        ]
      : course.id === "react-lite"
      ? [
          [
            "Dashboard foundations",
            "Bootstrap the modern React stack and build pages, components, state, routing, and Tailwind layouts.",
          ],
          [
            "Functional admin application",
            "Add a typed dummy API wrapper, CRUD forms, tables, filtering, loading/error states, and basic tests.",
          ],
          [
            "React Lite capstone",
            "Ship a responsive admin dashboard that can later swap its dummy service implementation for a real API.",
          ],
        ]
      : course.id === "react-enterprise"
      ? [
          [
            "Enterprise feature foundation",
            "Build a typed Vite/React application with route-owned data, reusable UI primitives, and focused component tests.",
          ],
          [
            "Production business workflow",
            "Add API boundaries, mutations, auth-aware UX, accessibility, observability, performance evidence, and browser tests.",
          ],
          [
            "Frontend platform capstone",
            "Define feature architecture, design-system boundaries, upgrade policy, delivery checks, and ownership for a multi-team React application.",
          ],
        ]
      : course.languageId === "python"
      ? [
          [
            "Foundation API",
            "Model lessons, publish a typed HTTP contract, and prove it with tests.",
          ],
          [
            "Production service",
            "Add persistence, authorization, background work, structured telemetry, and a safe release path.",
          ],
          [
            "Staff capstone",
            "Design the multi-tenant learning platform, write its ADR, and define ownership and SLOs.",
          ],
        ]
      : course.languageId === "rust"
        ? [
            [
              "Foundation service",
              "Build a typed Axum service with Cargo quality gates and contract tests.",
            ],
            [
              "Production service",
              "Add persistence, authorization, bounded Tokio concurrency, tracing, and safe delivery.",
            ],
            [
              "Staff capstone",
              "Design an evidence-backed Rust platform with explicit ownership, SLOs, and recovery.",
            ],
          ]
        : [
            [
              "Foundation API",
              "Model a small API with modern C# types and contract tests.",
            ],
            [
              "Production service",
              "Add persistence, cancellation, telemetry, and a safe release path.",
            ],
            [
              "Staff capstone",
              "Write an evidence-backed architecture decision with ownership and operational measures.",
            ],
          ];
  return (
    <section className="mx-auto w-full max-w-4xl px-7 py-12 sm:px-12">
      <p className="text-[10px] font-bold tracking-[1.4px] text-[#5d886f]">
        PROJECT STUDIO
      </p>
      <h1 className="mt-2 font-display text-5xl font-semibold tracking-[-2px] text-forest">
        Build the real thing.
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[#59635c]">
        Projects turn isolated lessons into evidence of engineering judgment.
        Each stage is unlocked by the supporting learning path.
      </p>
      <div className="mt-9 grid gap-4">
        {stages.map(([title, description], index) => {
          const unlocked =
            index === 0 ||
            completed.length >=
              Math.ceil((lessons.length * index) / stages.length);
          return (
            <div
              key={title}
              className={`rounded-xl border p-5 ${unlocked ? "border-[#c9ddd2] bg-[#fffefa]" : "border-[#e0ded7] bg-[#f3f1ea] text-[#858a84]"}`}
            >
              <div className="flex items-start gap-4">
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${unlocked ? "bg-[#dcefe5] text-[#176c53]" : "bg-[#e3e2dc]"}`}
                >
                  {index + 1}
                </span>
                <div>
                  <h2 className="font-display text-2xl font-semibold text-forest">
                    {title}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-[#657068]">
                    {description}
                  </p>
                  <button
                    onClick={() => (unlocked ? onLearn() : onLocked())}
                    className="mt-4 text-xs font-bold text-[#278164]"
                  >
                    {unlocked
                      ? "Open supporting lessons →"
                      : "Complete more lessons to unlock"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type SnippetLanguage =
  | "csharp"
  | "python"
  | "rust"
  | "typescript"
  | "javascript"
  | "html"
  | "css"
  | "json"
  | "shell"
  | "plaintext";

const shellCommandPattern =
  /(^|\n)\s*(?:\$\s*)?(?:git|npm|npx|pnpm|yarn|dotnet|cargo|rustup|python(?:3)?|pip|pip3|uv|docker|docker-compose|curl|wget|cd|mkdir|rm|cp|mv|echo|printf|export|source|chmod|grep|cat)\b/;

const looksLikeJson = (code: string) => {
  const trimmed = code.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return /^\{[\s\S]*(?:"[^"]+"\s*:)/.test(trimmed);
  }
};

const looksLikeFileTree = (code: string) => {
  const lines = code.split("\n").filter((line) => line.trim());
  return (
    lines.length >= 3 &&
    lines.filter((line) => /^\s*[\w.@-]+\/?\s*$/.test(line)).length >=
      Math.ceil(lines.length * 0.75)
  );
};

function snippetLanguage(lesson: Lesson, code = lesson.example): SnippetLanguage {
  const trimmed = code.trim();
  if (!trimmed) return "plaintext";
  if (trimmed.startsWith("#!") || shellCommandPattern.test(trimmed)) return "shell";
  if (looksLikeJson(trimmed)) return "json";
  if (looksLikeFileTree(trimmed)) return "plaintext";

  if (lesson.slug.startsWith("git-")) return "shell";
  if (lesson.slug.startsWith("react-")) return "typescript";
  if (lesson.slug.startsWith("web-basics-")) {
    if (/^<[/!a-zA-Z]/.test(trimmed)) return "html";
    if (/^(?:@media|@supports|@keyframes|[.#][\w-]+\s*\{)/.test(trimmed)) return "css";
    if (/^(?:type|interface)\s/.test(trimmed)) return "typescript";
    if (/\b(?:const|let|function|async|await|fetch|Promise)\b/.test(trimmed))
      return "javascript";
    return "plaintext";
  }
  if (lesson.version.language.startsWith("Python")) return "python";
  if (lesson.version.language.startsWith("Rust")) return "rust";
  if (lesson.version.language.startsWith("C#")) return "csharp";
  if (lesson.version.language.startsWith("Claude")) return "plaintext";
  return "plaintext";
}

const snippetLanguageLabel: Record<SnippetLanguage, string> = {
  csharp: "C#",
  python: "Python",
  rust: "Rust",
  typescript: "TypeScript / TSX",
  javascript: "JavaScript",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  shell: "Shell / CLI",
  plaintext: "Text",
};

function HighlightedCode({
  code,
  language,
  className = "",
}: {
  code: string;
  language: SnippetLanguage;
  className?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    if (language === "plaintext") return () => { cancelled = true; };

    void loader
      .init()
      .then((monaco) => {
        monaco.editor.setTheme("vs-dark");
        return monaco.editor.colorize(code, language, { tabSize: 2 });
      })
      .then((highlighted) => {
        if (!cancelled) setHtml(highlighted);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return (
    <pre
      className={className}
      data-syntax-language={language}
      data-syntax-highlighted={language === "plaintext" ? "plain" : html ? "true" : "pending"}
    >
      {html ? (
        <code dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <code>{code}</code>
      )}
    </pre>
  );
}

function LessonContent({ lesson }: { lesson: Lesson }) {
  const language = snippetLanguage(lesson);
  return (
    <article className="border-b border-[#e1dfd6] bg-[#fbf9f3] px-6 py-12 sm:px-8 lg:border-b-0 lg:border-r lg:px-[clamp(28px,3.5vw,56px)] lg:py-16">
      <p className="text-[10px] font-bold tracking-[1.15px] text-[#6e786f]">
        <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[#e5744d]" />
        {lesson.module.toUpperCase()}{" "}
        <span className="mx-2 text-[#a6ada7]">/</span> LESSON{" "}
        {String(lesson.order).padStart(2, "0")}
      </p>
      <div className="mb-5 mt-6 flex gap-4">
        <span className="pt-2 font-display text-[27px] text-[#b6bbb2]">
          {String(lesson.order).padStart(2, "0")}
        </span>
        <h1 className="font-display text-[48px] font-semibold leading-[1.02] tracking-[-2.5px] text-forest sm:text-[56px]">
          {lesson.title}
        </h1>
      </div>
      <p className="mb-7 max-w-[385px] font-display text-[18px] leading-relaxed text-[#48524b]">
        {lesson.subtitle}
      </p>
      <div className="flex gap-3 rounded-r-md border-l-[3px] border-[#54a987] bg-[#e5f2eb] px-4 py-3.5 text-[13px] leading-relaxed text-[#2e453a]">
        <Sparkles className="mt-0.5 shrink-0 text-[#278164]" size={15} />
        <p className="m-0">
          <strong>Key idea:</strong> {lesson.concept}
        </p>
      </div>
      <p className="my-6 text-sm leading-relaxed text-[#454d47]">
        {lesson.body}
      </p>
      <div className="overflow-hidden rounded-md bg-[#252b28] shadow-sm">
        <div className="bg-[#303735] px-4 py-2 font-mono text-[10px] text-[#bbc4bb]">
          {snippetLanguageLabel[language]}
        </div>
        <HighlightedCode
          code={lesson.example}
          language={language}
          className="syntax-code m-0 overflow-auto p-4 font-mono text-xs leading-7 text-[#dce6de]"
        />
      </div>
      <p className="mt-5 text-[11px] leading-relaxed text-[#727b73]">
        Reviewed {lesson.version.lastReviewed} · {lesson.version.language} /{" "}
        {lesson.version.framework}
      </p>
    </article>
  );
}

const hookStarterScript = `#!/bin/bash
COMMAND=$(jq -r '.tool_input.command')

if echo "$COMMAND" | grep -q 'rm -rf'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Destructive command blocked by hook"
    }
  }'
else
  exit 0
fi
`;

const hookCommandPresets = [
  { label: "Destructive rm", command: "rm -rf /tmp/build" },
  { label: "Run tests", command: "npm test" },
  { label: "Force push", command: "git push --force origin main" },
];

function HookPlayground() {
  const [matcher, setMatcher] = useState("Bash");
  const [script, setScript] = useState(hookStarterScript);
  const [command, setCommand] = useState(hookCommandPresets[0].command);
  const [result, setResult] = useState<HookPlaygroundResult | null>(null);
  const [running, setRunning] = useState(false);
  const runHook = async () => {
    setRunning(true);
    setResult(null);
    try {
      const response = await fetch(`${api}/api/claude-hooks/evaluate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Learner-Id": learnerId,
        },
        body: JSON.stringify({
          event: "PreToolUse",
          matcher,
          script,
          command,
        }),
      });
      if (!response.ok) {
        let message = "The Hook Playground is unavailable.";
        try {
          const payload = await response.json();
          message = payload.detail ?? payload.message ?? message;
        } catch {
          // Keep the friendly fallback when the API returns non-JSON diagnostics.
        }
        throw new Error(message);
      }
      const next: HookPlaygroundResult = await response.json();
      setResult(next);
      void trackActivity({
        eventType: "hook_run",
        courseId: "claude-engineering",
        lessonSlug: "claude-hooks-pretooluse",
        workspace: "learn",
        detail: next.outcome,
      });
    } catch (error) {
      setResult({
        matcherMatched: false,
        executed: false,
        exitCode: null,
        outcome: "error",
        summary:
          error instanceof Error ? error.message : "The Hook Playground is unavailable.",
        reason: null,
        stdout: "",
        stderr: "",
        inputJson: "",
      });
    } finally {
      setRunning(false);
    }
  };

  const outcomeLabel =
    result?.outcome === "denied" || result?.outcome === "blocked"
      ? "BLOCKED"
      : result?.outcome === "allowed"
        ? "ALLOWED"
        : result?.outcome === "ask"
          ? "ASK"
          : result?.outcome === "deferred"
            ? "DEFERRED"
            : result?.outcome === "skipped"
              ? "SKIPPED"
              : result?.outcome === "no_decision"
                ? "NO DECISION"
                : "ERROR";

  return (
    <div className="mt-9 overflow-hidden rounded-xl border border-[#3b3052] bg-[#0d0b13] shadow-[0_18px_55px_#00000033]">
      <div className="border-b border-[#30283f] px-5 py-4">
        <p className="text-[10px] font-bold tracking-[1.3px] text-[#5d886f]">
          HOOK PLAYGROUND
        </p>
        <h3 className="mt-1 font-display text-xl font-semibold text-white">
          Run a real PreToolUse hook
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-[#aaa4b7]">
          Pathway sends a simulated Bash tool call to your script as JSON on stdin and runs the hook in an isolated sandbox.
        </p>
      </div>

      <div className="grid gap-0 xl:grid-cols-[1.15fr_.85fr]">
        <div className="border-b border-[#30283f] p-5 xl:border-b-0 xl:border-r">
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <label className="text-xs text-[#aaa4b7]">
              Matcher
              <input
                value={matcher}
                onChange={(event) => setMatcher(event.target.value)}
                className="mt-2 w-full rounded-md border border-[#3b3052] bg-[#171321] px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#7652a6]"
              />
            </label>
            <label className="text-xs text-[#aaa4b7]">
              Simulated Bash command
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                className="mt-2 w-full rounded-md border border-[#3b3052] bg-[#171321] px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#7652a6]"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {hookCommandPresets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => setCommand(preset.command)}
                className="rounded-full border border-[#3b3052] px-3 py-1.5 text-[10px] font-bold text-[#aaa4b7] hover:border-[#7652a6] hover:text-white"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs text-[#aaa4b7]">
              <span>Hook script</span>
              <span className="font-mono text-[10px] text-[#81768f]">hook.sh · Bash</span>
            </div>
            <div className="overflow-hidden rounded-md border border-[#3b3052] bg-[#101018] focus-within:border-[#7652a6]">
              <Editor
                height="320px"
                language="shell"
                theme="vs-dark"
                value={script}
                onChange={(value) => setScript(value ?? "")}
                options={{
                  automaticLayout: true,
                  minimap: { enabled: false },
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 12,
                  lineHeight: 22,
                  padding: { top: 14, bottom: 14 },
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                  insertSpaces: true,
                  renderLineHighlight: "all",
                  wordWrap: "off",
                  ariaLabel: "Hook script",
                }}
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => void runHook()}
              disabled={running}
              className="rounded-md bg-[#ea7850] px-4 py-3 text-xs font-bold text-white hover:bg-[#d9653d] disabled:cursor-wait disabled:opacity-60"
            >
              <Play className="mr-1.5 inline fill-current" size={11} />
              {running ? "Running hook…" : "Run hook"}
            </button>
            <button
              onClick={() => {
                setScript(hookStarterScript);
                setMatcher("Bash");
                setCommand(hookCommandPresets[0].command);
                setResult(null);
              }}
              className="rounded-md border border-[#3b3052] px-3 py-3 text-xs font-bold text-[#aaa4b7] hover:border-[#7652a6] hover:text-white"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="p-5">
          <p className="text-[10px] font-bold tracking-[1.3px] text-[#5d886f]">
            CLAUDE CODE RESULT
          </p>
          {result ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-[#3b3052] bg-[#171321] p-4">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm text-white">{outcomeLabel}</strong>
                  <span className="font-mono text-[10px] text-[#81768f]">
                    exit {result.exitCode ?? "—"}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#b9b3c8]">
                  {result.summary}
                </p>
                {result.reason && (
                  <p className="mt-3 rounded-md bg-[#ffffff08] px-3 py-2 text-xs leading-relaxed text-[#d7cbe8]">
                    {result.reason}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded-md border border-[#30283f] p-3">
                  <span className="text-[#81768f]">Matcher</span>
                  <strong className="mt-1 block text-white">
                    {result.matcherMatched ? "matched" : "did not match"}
                  </strong>
                </div>
                <div className="rounded-md border border-[#30283f] p-3">
                  <span className="text-[#81768f]">Handler</span>
                  <strong className="mt-1 block text-white">
                    {result.executed ? "executed" : "skipped"}
                  </strong>
                </div>
              </div>

              {result.inputJson && (
                <details className="rounded-md border border-[#30283f] bg-[#101018] p-3">
                  <summary className="cursor-pointer text-xs font-bold text-[#d7cbe8]">
                    Simulated stdin JSON
                  </summary>
                  <HighlightedCode
                    code={JSON.stringify(JSON.parse(result.inputJson), null, 2)}
                    language="json"
                    className="syntax-code mt-3 max-h-[220px] overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-5 text-[#aaa4b7]"
                  />
                </details>
              )}
              {(result.stdout || result.stderr) && (
                <details className="rounded-md border border-[#30283f] bg-[#101018] p-3">
                  <summary className="cursor-pointer text-xs font-bold text-[#d7cbe8]">
                    Raw hook output
                  </summary>
                  {result.stdout && (
                    <pre className="mt-3 max-h-[180px] overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-5 text-[#aaa4b7]">
                      {result.stdout}
                    </pre>
                  )}
                  {result.stderr && (
                    <pre className="mt-3 max-h-[180px] overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-5 text-[#d49393]">
                      {result.stderr}
                    </pre>
                  )}
                </details>
              )}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-[#3b3052] p-5 text-xs leading-relaxed text-[#81768f]">
              Run the starter hook against <code>rm -rf /tmp/build</code>. Then switch to <code>npm test</code> and observe how a silent exit 0 leaves normal permission handling in place.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PresentationPanel({
  lesson,
  canGoBack,
  onBack,
  onNext,
}: {
  lesson: Lesson;
  canGoBack: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <section className="bg-panel px-6 py-10 sm:px-8 lg:px-[clamp(24px,3vw,48px)] lg:py-[42px]">
      <p className="text-[10px] font-bold tracking-[1.2px] text-[#5d886f]">
        LESSON NOTES
      </p>
      <h2 className="mt-1 font-display text-[29px] font-semibold tracking-[-.8px]">
        {lesson.exercise.title}
      </h2>
      <p className="mt-5 text-sm leading-relaxed text-[#59635c]">
        {lesson.exercise.prompt}
      </p>
      <div className="mt-6 grid gap-3">
        {lesson.exercise.requirements.map((point) => (
          <div key={point} className="flex gap-3 text-sm leading-relaxed text-[#5d886f]">
            <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#e5f2eb] text-[11px] font-bold text-[#278164]">
              ✓
            </span>
            <span>{point}</span>
          </div>
        ))}
      </div>
      {lesson.slug === "claude-hooks-pretooluse" && <HookPlayground />}
      <a
        href={lesson.version.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex text-xs font-bold text-[#5f37a1] hover:underline"
      >
        Open the Claude Code hooks reference ↗
      </a>
      {lesson.nextSlug ? (
        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={onBack}
            disabled={!canGoBack}
            className="flex items-center gap-2 rounded-md border border-[#3b3052] bg-[#171321] px-4 py-3 text-xs font-bold text-[#d7cbe8] transition hover:border-[#7652a6] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <button
            onClick={onNext}
            className="flex items-center gap-2 rounded-md bg-[#ea7850] px-4 py-3 text-xs font-bold text-white hover:bg-[#d9653d]"
          >
            Continue <ArrowRight size={14} />
          </button>
        </div>
      ) : (
        <div className="mt-8">
          <button
            onClick={onBack}
            disabled={!canGoBack}
            className="mb-4 flex items-center gap-2 rounded-md border border-[#3b3052] bg-[#171321] px-4 py-3 text-xs font-bold text-[#d7cbe8] transition hover:border-[#7652a6] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <div className="rounded-lg border border-[#dce7de] bg-[#f6fbf7] p-4 text-sm text-[#365748]">
            <strong className="block">Course complete.</strong>
            <span className="mt-1 block text-xs">
              You’ve completed the Claude Hooks course. Revisit any lesson from the sidebar whenever you need a refresher.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function ExercisePanel({
  lesson,
  answer,
  setAnswer,
  unit,
  setUnit,
  meterMode,
  setMeterMode,
  redProbe,
  setRedProbe,
  blackProbe,
  setBlackProbe,
  diagnosis,
  setDiagnosis,
  code,
  setCode,
  result,
  passed,
  submit,
  onReset,
  onNext,
}: {
  lesson: Lesson;
  answer: string;
  setAnswer: (v: string) => void;
  unit: string;
  setUnit: (v: string) => void;
  meterMode: string;
  setMeterMode: (v: string) => void;
  redProbe: string;
  setRedProbe: (v: string) => void;
  blackProbe: string;
  setBlackProbe: (v: string) => void;
  diagnosis: string;
  setDiagnosis: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
  result: Result | null;
  passed: boolean;
  submit: () => void;
  onReset: () => void;
  onNext: () => void;
}) {
  const e = lesson.exercise;
  const language = lesson.slug.startsWith("react-")
    ? "TypeScript"
    : lesson.version.language.startsWith("Python")
    ? "Python"
    : lesson.version.language.startsWith("Rust")
      ? "Rust"
      : lesson.version.language.startsWith("Git")
        ? "Shell"
        : "C#";
  return (
    <section className="bg-panel px-7 py-10 sm:px-[9vw] lg:px-[clamp(27px,4vw,58px)] lg:py-[42px]">
      <p className="text-[10px] font-bold tracking-[1.2px] text-[#5d886f]">
        YOUR TURN
      </p>
      <h2 className="mt-1 font-display text-[29px] font-semibold tracking-[-.8px]">
        {e.title}
      </h2>
      <p className="mt-5 text-sm leading-relaxed text-[#59635c]">{e.prompt}</p>
      <div className="mb-6 mt-4 space-y-2 text-xs text-[#4f5b53]">
        {e.requirements.map((r) => (
          <p key={r} className="m-0">
            <Check className="mr-1 inline text-[#25916d]" size={14} />
            {r}
          </p>
        ))}
      </div>
      {e.kind === "MultipleChoice" ? (
        <div className="grid gap-2">
          {e.choices.map((choice) => (
            <button
              onClick={() => setAnswer(choice.id)}
              key={choice.id}
              className={`rounded-md border p-3 text-left text-sm transition ${answer === choice.id ? "border-[#258160] bg-[#e5f2eb] text-[#164e3b]" : "border-[#e1dfd6] bg-white hover:border-[#9ab9aa]"}`}
            >
              <span className="mr-2 font-mono text-xs text-[#6d897b]">
                {choice.id.toUpperCase()}
              </span>
              {choice.text}
            </button>
          ))}
        </div>
      ) : e.kind === "Numeric" ? (
        <div className="flex max-w-sm gap-2">
          <label className="sr-only" htmlFor={`numeric-answer-${lesson.slug}`}>Numeric answer</label>
          <input
            id={`numeric-answer-${lesson.slug}`}
            inputMode="decimal"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="0"
            className="min-w-0 flex-1 rounded-md border border-[#d5d2c9] bg-white px-3 py-3 font-mono text-sm text-[#26342d] outline-none focus:border-[#258160]"
          />
          <label className="sr-only" htmlFor={`numeric-unit-${lesson.slug}`}>Unit</label>
          <select
            id={`numeric-unit-${lesson.slug}`}
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className="rounded-md border border-[#d5d2c9] bg-white px-3 py-3 font-mono text-sm text-[#26342d] outline-none focus:border-[#258160]"
          >
            {[...new Set([e.unit, ...Object.keys(e.unitConversions ?? {})].filter(Boolean) as string[])].map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
      ) : e.kind === "Circuit" && e.circuit ? (
        <CircuitLab
          circuit={e.circuit}
          meterMode={meterMode}
          setMeterMode={setMeterMode}
          redProbe={redProbe}
          setRedProbe={setRedProbe}
          blackProbe={blackProbe}
          setBlackProbe={setBlackProbe}
          diagnosis={diagnosis}
          setDiagnosis={setDiagnosis}
        />
      ) : (
        <CodeEditor
          code={code}
          setCode={setCode}
          onReset={onReset}
          language={language}
        />
      )}
      <div className="my-5 flex items-center gap-3">
        <button
          onClick={submit}
          className="rounded-md bg-[#ea7850] px-3 py-2.5 text-xs font-bold text-white hover:bg-[#d9653d]"
        >
          <Play className="mr-1 inline fill-current" size={11} />
          {e.kind === "Code" ? "Run tests" : "Check answer"}{" "}
          <kbd className="ml-2 rounded bg-[#f3a082]/50 px-1.5 py-0.5 font-normal">
            ⌘ ↵
          </kbd>
        </button>
      </div>
      {result && (
        <div
          className={`overflow-hidden rounded-md border ${passed ? "border-[#dce7de] bg-[#f6fbf7]" : "border-[#f2c7ba] bg-[#fff7f4]"}`}
        >
          <div className="flex items-center gap-2 border-b border-inherit px-3.5 py-2.5 text-xs">
            <span
              className={`grid h-[17px] w-[17px] place-items-center rounded-full ${passed ? "bg-[#daf1e2] text-[#16835d]" : "bg-[#f9dfd7] text-[#ca5638]"}`}
            >
              {passed ? "✓" : "!"}
            </span>
            <strong>{passed ? (e.kind === "Numeric" || e.kind === "Circuit" ? "Correct" : "Passed") : "Try again"}</strong>
            <span
              className={`ml-auto text-[11px] ${passed ? "text-[#21815f]" : "text-[#c55a3d]"}`}
            >
              {result.passingTests} / {result.totalTests}
            </span>
          </div>
          <p className="px-3.5 py-3 text-xs leading-relaxed text-[#526157]">
            {result.feedback}
          </p>
        </div>
      )}
      {passed && result?.workedSolution && (
        <div className="mt-4 rounded-md border border-[#dce7de] bg-[#f6fbf7] p-3 text-xs text-[#365748]">
          <strong className="block">Worked solution</strong>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{result.workedSolution}</pre>
        </div>
      )}
      {result?.codeReview && (
        <details className="mt-4 rounded-md border border-[#d7cbec] bg-[#f6f1ff] p-3 text-xs text-[#514467]">
          <summary className="cursor-pointer font-bold text-[#5f37a1]">
            Code review suggestions
          </summary>
          <p className="mb-2 mt-3 leading-relaxed">
            {result.codeReview.summary}
          </p>
          {result.codeReview.suggestions.length > 0 && (
            <ul className="list-disc space-y-2 pl-4 leading-relaxed">
              {result.codeReview.suggestions.map((suggestion) => (
                <li key={suggestion}>{suggestion}</li>
              ))}
            </ul>
          )}
        </details>
      )}
      {passed && (
        <details className="mt-4 rounded-md border border-[#e6dfd2] bg-[#fbf7ef] p-3 text-xs text-[#5b615b]">
          <summary className="cursor-pointer font-bold text-[#47554d]">
            Review the worked example
          </summary>
          <p className="mb-2 mt-3 leading-relaxed">
            This example demonstrates the same concept. Compare its intent with
            your solution rather than trying to match it
            character-for-character.
          </p>
          <HighlightedCode
            code={lesson.example}
            language={snippetLanguage(lesson)}
            className="syntax-code overflow-auto rounded bg-[#252b28] p-3 font-mono text-[11px] leading-relaxed text-[#dce6de]"
          />
        </details>
      )}
      {passed && lesson.nextSlug && (
        <button
          onClick={onNext}
          className="mt-5 rounded-md bg-pine px-4 py-3 text-[13px] font-bold text-white"
        >
          Next lesson <span className="pl-6 text-lg">→</span>
        </button>
      )}
      <div className="mt-5 flex gap-2 rounded-md bg-[#f7f0e8] p-3 text-[11px] leading-relaxed text-[#726656]">
        <Sparkles className="shrink-0 text-[#d68b4e]" size={14} />
        <p className="m-0">
          <strong>Hint</strong>
          <br />
          {e.hint}
        </p>
      </div>
    </section>
  );
}

function CircuitLab({
  circuit,
  meterMode,
  setMeterMode,
  redProbe,
  setRedProbe,
  blackProbe,
  setBlackProbe,
  diagnosis,
  setDiagnosis,
}: {
  circuit: CircuitDefinition;
  meterMode: string;
  setMeterMode: (value: string) => void;
  redProbe: string;
  setRedProbe: (value: string) => void;
  blackProbe: string;
  setBlackProbe: (value: string) => void;
  diagnosis: string;
  setDiagnosis: (value: string) => void;
}) {
  const [activeProbe, setActiveProbe] = useState<"red" | "black">("red");
  const nodeMap = new Map(circuit.nodes.map((node) => [node.id, node]));
  const exact = circuit.measurements.find(
    (item) =>
      item.meterMode === meterMode &&
      item.redNode === redProbe &&
      item.blackNode === blackProbe,
  );
  const reversed = circuit.measurements.find(
    (item) =>
      meterMode === "V DC" &&
      item.meterMode === meterMode &&
      item.redNode === blackProbe &&
      item.blackNode === redProbe &&
      item.value != null,
  );
  const liveDisplay = exact?.display ?? (reversed?.value != null ? `${(-reversed.value).toFixed(3)} ${reversed.unit}` : "—");

  const placeProbe = (nodeId: string) => {
    if (activeProbe === "red") {
      setRedProbe(nodeId);
      if (blackProbe !== nodeId) setActiveProbe("black");
    } else {
      setBlackProbe(nodeId);
      if (redProbe !== nodeId) setActiveProbe("red");
    }
  };

  const componentShape = (component: CircuitComponent) => {
    const from = nodeMap.get(component.fromNode);
    const to = nodeMap.get(component.toNode);
    if (!from || !to) return null;
    const x1 = from.x, y1 = from.y, x2 = to.x, y2 = to.y;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    if (component.kind === "resistor") {
      const points = [
        [x1, y1], [mx - 14, my], [mx - 10, my - 5], [mx - 6, my + 5],
        [mx - 2, my - 5], [mx + 2, my + 5], [mx + 6, my - 5],
        [mx + 10, my + 5], [mx + 14, my], [x2, y2],
      ].map(([x,y]) => `${x},${y}`).join(" ");
      return <polyline key={component.id} points={points} fill="none" stroke="currentColor" strokeWidth="1.8" />;
    }
    if (component.kind === "led") {
      return (
        <g key={component.id}>
          <line x1={x1} y1={y1} x2={mx - 5} y2={my} stroke="currentColor" strokeWidth="1.8" />
          <polygon points={`${mx-5},${my-7} ${mx-5},${my+7} ${mx+5},${my}`} fill="none" stroke="currentColor" strokeWidth="1.8" />
          <line x1={mx + 7} y1={my - 8} x2={mx + 7} y2={my + 8} stroke="currentColor" strokeWidth="1.8" />
          <line x1={mx + 7} y1={my} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1.8" />
        </g>
      );
    }
    if (component.kind === "source") {
      return (
        <g key={component.id}>
          <line x1={x1} y1={y1} x2={mx - 5} y2={my} stroke="currentColor" strokeWidth="1.8" />
          <circle cx={mx} cy={my} r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <text x={mx} y={my + 2.5} textAnchor="middle" fontSize="6" fill="currentColor">+</text>
          <line x1={mx + 7} y1={my} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1.8" />
        </g>
      );
    }
    return <line key={component.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1.8" />;
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[#d9d5ca] bg-[#fffefa]">
      <div className="border-b border-[#e1ddd2] px-4 py-3">
        <strong className="block text-sm text-[#26342d]">{circuit.title}</strong>
        <span className="mt-1 block text-xs text-[#667068]">{circuit.description}</span>
      </div>
      <div className="grid gap-4 p-4 xl:grid-cols-[1fr_210px]">
        <div>
          <div className="rounded-lg border border-[#d9d5ca] bg-[#f7f5ee] p-3 text-[#33423a]">
            <svg viewBox="0 0 100 52" className="h-[230px] w-full" role="img" aria-label={circuit.title}>
              {circuit.components.map(componentShape)}
              {circuit.components.map((component) => {
                const from = nodeMap.get(component.fromNode), to = nodeMap.get(component.toNode);
                if (!from || !to) return null;
                return (
                  <text key={`${component.id}-label`} x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 10} textAnchor="middle" fontSize="4" fill="currentColor">
                    {component.label}{component.value ? ` · ${component.value}` : ""}
                  </text>
                );
              })}
              {circuit.nodes.map((node) => (
                <g key={node.id} onClick={() => placeProbe(node.id)} className="cursor-pointer" role="button" aria-label={`Circuit node ${node.label}`}>
                  <circle cx={node.x} cy={node.y} r="5.5" fill="transparent" />
                  <circle cx={node.x} cy={node.y} r="2.2" fill={redProbe === node.id ? "#d84f4f" : blackProbe === node.id ? "#252525" : "#fffefa"} stroke="currentColor" strokeWidth="1.2" />
                  <text x={node.x} y={node.y + 9} textAnchor="middle" fontSize="4" fill="currentColor">{node.label}</text>
                  {redProbe === node.id && <text x={node.x} y={node.y - 5} textAnchor="middle" fontSize="4" fill="#b52e2e">RED</text>}
                  {blackProbe === node.id && <text x={node.x} y={node.y - 5} textAnchor="middle" fontSize="4" fill="#222">BLACK</text>}
                </g>
              ))}
            </svg>
          </div>
          <p className="mt-3 rounded-md bg-[#f7f0e8] px-3 py-2 text-[11px] leading-relaxed text-[#726656]">
            <strong>Safety:</strong> {circuit.safetyNote}
          </p>
        </div>
        <div className="space-y-3">
          <div className="rounded-lg bg-[#202521] p-3 text-white">
            <span className="text-[9px] font-bold tracking-[1px] text-[#9ca69f]">VIRTUAL MULTIMETER</span>
            <div className="mt-3 rounded bg-[#b9d1af] px-3 py-4 text-right font-mono text-2xl text-[#172117]" aria-label="Meter reading">
              {liveDisplay}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {circuit.meterModes.map((mode) => (
                <button key={mode} onClick={() => setMeterMode(mode)} className={`rounded px-2 py-2 text-[10px] font-bold ${meterMode === mode ? "bg-[#ea7850] text-white" : "bg-[#303832] text-[#c9d0ca]"}`}>
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setActiveProbe("red")} className={`rounded-md border px-2 py-2 text-[10px] font-bold ${activeProbe === "red" ? "border-[#d84f4f] bg-[#fff0f0] text-[#a92f2f]" : "border-[#ddd8ce]"}`}>Place red</button>
            <button onClick={() => setActiveProbe("black")} className={`rounded-md border px-2 py-2 text-[10px] font-bold ${activeProbe === "black" ? "border-[#444] bg-[#eee] text-[#222]" : "border-[#ddd8ce]"}`}>Place black</button>
          </div>
          <p className="text-xs leading-relaxed text-[#59635c]">{circuit.task.instruction}</p>
        </div>
      </div>
      {circuit.task.diagnosisChoices.length > 0 && (
        <div className="border-t border-[#e1ddd2] p-4">
          <p className="mb-2 text-[10px] font-bold tracking-[1px] text-[#6e786f]">DIAGNOSIS</p>
          <div className="grid gap-2">
            {circuit.task.diagnosisChoices.map((choice) => (
              <button key={choice.id} onClick={() => setDiagnosis(choice.id)} className={`rounded-md border p-3 text-left text-xs ${diagnosis === choice.id ? "border-[#258160] bg-[#e5f2eb] text-[#164e3b]" : "border-[#e1dfd6] bg-white"}`}>
                {choice.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CodeEditor({
  code,
  setCode,
  onReset,
  language,
}: {
  code: string;
  setCode: (v: string) => void;
  onReset: () => void;
  language: "C#" | "Python" | "Rust" | "Shell" | "TypeScript";
}) {
  const isPython = language === "Python";
  const isRust = language === "Rust";
  const isShell = language === "Shell";
  const isTypeScript = language === "TypeScript";
  return (
    <div className="overflow-hidden rounded-md border border-[#303735] shadow-md shadow-[#19241f]/5">
      <div className="flex justify-between bg-[#2a302e] px-3 py-2.5 font-mono text-[11px] text-[#c3cac3]">
        <span>
          <i className="mr-2 inline-block h-2 w-2 rounded-full bg-[#55b794]" />
          {isPython ? "main.py" : isRust ? "main.rs" : isShell ? "exercise.sh" : isTypeScript ? "App.tsx" : "Program.cs"}
        </span>
        <span>
          <button
            onClick={onReset}
            className="mr-3 text-[#aeb8ae]"
            title="Reset"
          >
            <RotateCcw size={15} />
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(code)}
            className="text-[#aeb8ae]"
            title="Copy"
          >
            <Clipboard size={15} />
          </button>
        </span>
      </div>
      <Editor
        height="245px"
        language={isPython ? "python" : isRust ? "rust" : isShell ? "shell" : isTypeScript ? "typescript" : "csharp"}
        theme="vs-dark"
        value={code}
        onChange={(value) => setCode(value ?? "")}
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
          fontFamily: "'DM Mono', monospace",
          fontSize: 13,
          lineHeight: 22,
          padding: { top: 12, bottom: 12 },
          scrollBeyondLastLine: false,
          tabSize: 4,
          insertSpaces: true,
          renderLineHighlight: "all",
          ariaLabel: `${language} code editor`,
        }}
      />
    </div>
  );
}
export default App;
