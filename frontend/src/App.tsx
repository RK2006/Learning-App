import { useMemo, useState } from 'react';

type TopicForm = {
  topic: string;
  dailyTime: number;
  level: 'Easy' | 'Medium' | 'Hard';
};

type Concept = {
  id: string;
  name: string;
  order: number;
  mastery: number;
  status: 'locked' | 'current' | 'completed' | 'needs-review';
};

type Question = {
  id: string;
  type: 'multiple-choice' | 'short-answer';
  prompt: string;
  options?: string[];
  correctAnswer?: string;
  answer?: string;
};

type Lesson = {
  concept: string;
  title: string;
  explanation: string;
  example: string;
  questions: Question[];
};

type AssessmentResult = {
  score: number;
  correct: boolean;
  misconceptions: string[];
  feedback: string;
  needs_review: boolean;
};

const defaultForm: TopicForm = {
  topic: 'Probability',
  dailyTime: 10,
  level: 'Medium',
};

const demoConcepts: Concept[] = [
  { id: '1', name: 'Sample Spaces', order: 1, mastery: 30, status: 'completed' },
  { id: '2', name: 'Events', order: 2, mastery: 45, status: 'completed' },
  { id: '3', name: 'Basic Probability', order: 3, mastery: 62, status: 'completed' },
  { id: '4', name: 'Conditional Probability', order: 4, mastery: 58, status: 'current' },
  { id: '5', name: 'Independence', order: 5, mastery: 40, status: 'locked' },
  { id: '6', name: "Bayes' Theorem", order: 6, mastery: 20, status: 'locked' },
  { id: '7', name: 'Random Variables', order: 7, mastery: 10, status: 'locked' },
];

const demoLesson: Lesson = {
  concept: 'Conditional Probability',
  title: 'Understanding conditional probability',
  explanation:
    'Conditional probability asks: if we already know that event B happened, what is the chance that event A also happened? We write it as P(A|B), which means probability of A given B.',
  example:
    'If 20 of 100 students study statistics and 10 of those 20 also play chess, then the chance a student plays chess given they study statistics is 10/20 = 0.5.',
  questions: [
    {
      id: 'mc1',
      type: 'multiple-choice',
      prompt: 'Which equation represents conditional probability?',
      options: ['P(A|B) = P(A) / P(B)', 'P(A|B) = P(A and B) / P(B)', 'P(A|B) = P(A and B) + P(B)', 'P(A|B) = P(B) / P(A)'],
      correctAnswer: 'P(A|B) = P(A and B) / P(B)',
    },
    {
      id: 'sa1',
      type: 'short-answer',
      prompt: 'Explain conditional probability in your own words and give one example.',
    },
  ],
};

function App() {
  const [form, setForm] = useState<TopicForm>(defaultForm);
  const [showSetup, setShowSetup] = useState(true);
  const [pathGenerated, setPathGenerated] = useState(false);
  const [selectedConcept, setSelectedConcept] = useState('Conditional Probability');
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [showAssessment, setShowAssessment] = useState(false);
  const [concepts, setConcepts] = useState<Concept[]>(demoConcepts);
  const [lesson, setLesson] = useState<Lesson | null>(demoLesson);
  const [assessment, setAssessment] = useState<AssessmentResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const progressStats = useMemo(() => {
    const completed = concepts.filter((c) => c.status === 'completed').length;
    const mastered = concepts.filter((c) => c.mastery >= 75).length;
    const review = concepts.filter((c) => c.status === 'needs-review').length;
    const total = concepts.length;
    return { completed, mastered, review, total, streak: 6, sessions: 9 };
  }, [concepts]);

  const activeLesson = lesson ?? demoLesson;
  const currentQuestionData = activeLesson.questions[currentQuestion] ?? activeLesson.questions[0];

  const generateLearningPath = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const setupResponse = await fetch('http://localhost:8000/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: form.topic,
          goal: '',
          daily_time: form.dailyTime,
          level: form.level,
        }),
      });

      if (!setupResponse.ok) {
        throw new Error('Unable to generate path');
      }

      const setupData = await setupResponse.json();
      setConcepts(setupData.concepts || demoConcepts);
      setSelectedConcept((setupData.concepts || demoConcepts)[3]?.name || 'Conditional Probability');

      const lessonResponse = await fetch('http://localhost:8000/lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: form.topic,
          goal: '',
          daily_time: form.dailyTime,
          level: form.level,
        }),
      });

      if (!lessonResponse.ok) {
        throw new Error('Unable to generate lesson');
      }

      const lessonData = await lessonResponse.json();
      setLesson(lessonData);
      setPathGenerated(true);
      setShowSetup(false);
      setShowAssessment(false);
      setCurrentQuestion(0);
      setAnswers({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setPathGenerated(true);
      setShowSetup(false);
      setLesson(demoLesson);
      setConcepts(demoConcepts);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswer = async (value: string) => {
    const current = activeLesson.questions[currentQuestion];
    const updatedAnswers = { ...answers, [current.id]: value };
    setAnswers(updatedAnswers);

    if (currentQuestion < activeLesson.questions.length - 1) {
      setCurrentQuestion((prev) => prev + 1);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const assessmentResponse = await fetch('http://localhost:8000/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: form.topic,
          answers: updatedAnswers,
          lesson: activeLesson,
        }),
      });

      if (!assessmentResponse.ok) {
        throw new Error('Assessment failed');
      }

      const result = await assessmentResponse.json();
      setAssessment(result);
      setShowAssessment(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assessment failed.');
      setAssessment({
        score: 75,
        correct: true,
        misconceptions: ['Confuses P(A|B) with P(B|A)'],
        feedback:
          'You understand the basic idea, but you should be careful not to reverse the condition and the event. Review the definition and compare P(A|B) with P(B|A) in a worked example.',
        needs_review: true,
      });
      setShowAssessment(true);
    } finally {
      setIsLoading(false);
    }
  };

  const resetTopicFlow = () => {
    setShowSetup(true);
    setPathGenerated(false);
    setShowAssessment(false);
    setCurrentQuestion(0);
    setAnswers({});
    setAssessment(null);
    setLesson(demoLesson);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">AI Learning</div>
        <nav>
          <button className="nav-button active">Home</button>
          <button className="nav-button">Setup</button>
          <button className="nav-button">Learning Path</button>
          <button className="nav-button">Daily Lesson</button>
          <button className="nav-button">Results</button>
          <button className="nav-button">Progress</button>
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">Current goal</div>
            <h1>{form.topic}</h1>
          </div>
          <div className="tag">{form.dailyTime} min / day</div>
        </header>

        {error && <div className="error-banner">{error}</div>}

        {showSetup && (
          <section className="panel">
            <h2>Topic setup</h2>
            <div className="form-grid">
              <label>
                Topic
                <input
                  value={form.topic}
                  onChange={(e) => setForm((prev) => ({ ...prev, topic: e.target.value }))}
                />
              </label>
              <label>
                Difficulty level
                <select
                  value={form.level}
                  onChange={(e) => setForm((prev) => ({ ...prev, level: e.target.value as TopicForm['level'] }))}
                >
                  <option>Easy</option>
                  <option>Medium</option>
                  <option>Hard</option>
                </select>
              </label>
              <label>
                Daily time (minutes)
                <input
                  type="number"
                  min={5}
                  max={15}
                  value={form.dailyTime}
                  onChange={(e) => setForm((prev) => ({ ...prev, dailyTime: Number(e.target.value) }))}
                />
              </label>
            </div>
            <button className="primary-button" onClick={generateLearningPath} disabled={isLoading}>
              {isLoading ? 'Generating...' : 'Generate learning path'}
            </button>
          </section>
        )}

        {pathGenerated && !showSetup && (
          <>
            <section className="stats-grid">
              <div className="stat-card">
                <span>Current streak</span>
                <strong>{progressStats.streak} days</strong>
              </div>
              <div className="stat-card">
                <span>Sessions completed</span>
                <strong>{progressStats.sessions}</strong>
              </div>
              <div className="stat-card">
                <span>Concepts learned</span>
                <strong>{progressStats.completed}/{progressStats.total}</strong>
              </div>
              <div className="stat-card">
                <span>Needs review</span>
                <strong>{progressStats.review}</strong>
              </div>
            </section>

            <section className="split-panel">
              <div className="panel">
                <h2>Learning path</h2>
                <ul className="concept-list">
                  {concepts.map((concept) => (
                    <li
                      key={concept.id}
                      className={selectedConcept === concept.name ? 'selected' : ''}
                      onClick={() => setSelectedConcept(concept.name)}
                    >
                      <div className="concept-left">
                        <span className={`status-dot ${concept.status}`} />
                        <span>{concept.name}</span>
                      </div>
                      <span className="mastery-pill">{concept.mastery}%</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="panel lesson-panel">
                <div className="lesson-header">
                  <div>
                    <div className="eyebrow">Today’s concept</div>
                    <h2>{activeLesson.concept}</h2>
                  </div>
                  <div className="chip">Adaptive review</div>
                </div>

                {!showAssessment ? (
                  <>
                    <div className="slide-box">
                      <h3>{activeLesson.title}</h3>
                      <p>{activeLesson.explanation}</p>
                      <div className="example-box">Example: {activeLesson.example}</div>
                    </div>

                    <div className="question-box">
                      <p>{currentQuestionData.prompt}</p>
                      {currentQuestionData.type === 'multiple-choice' && currentQuestionData.options ? (
                        <div className="options-grid">
                          {currentQuestionData.options.map((option) => (
                            <button key={option} className="option-button" onClick={() => handleAnswer(option)} disabled={isLoading}>
                              {option}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <>
                          <textarea
                            placeholder="Type your answer here..."
                            value={answers[currentQuestionData.id] || ''}
                            onChange={(e) => setAnswers((prev) => ({ ...prev, [currentQuestionData.id]: e.target.value }))}
                          />
                          <button className="primary-button" onClick={() => handleAnswer(answers[currentQuestionData.id] || '')} disabled={isLoading}>
                            {isLoading ? 'Submitting...' : 'Submit response'}
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="results-panel">
                    <h3>Assessment results</h3>
                    <div className="score-row">
                      <span>Score</span>
                      <strong>{assessment?.score ?? 0}%</strong>
                    </div>
                    <p>
                      <strong>AI feedback:</strong> {assessment?.feedback}
                    </p>
                    <p>
                      <strong>Misconceptions:</strong> {assessment?.misconceptions.join(', ') || 'None identified'}
                    </p>
                    <div className="recommendation-box">
                      Review {activeLesson.concept} tomorrow before moving on to Bayes&apos; theorem.
                    </div>
                    <button className="primary-button" onClick={resetTopicFlow}>
                      Start another topic
                    </button>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
