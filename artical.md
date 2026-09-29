The Failed Fix Became the Most Useful Data

The first thing I wanted DevLens to remember wasn't what worked. It was what failed.

Performance debugging is full of plausible explanations. A frame drops, CPU usage spikes, memory grows, and an engineer forms a hypothesis. We make a change, rerun the workload, and sometimes the numbers improve. Sometimes they don't. The uncomfortable part is that a failed fix is easy to throw away even though it may be the most useful evidence we collected.

I built DevLens around that problem.

The system is an Android performance investigator. It collects runtime evidence from an application, detects performance incidents, correlates the signals around the incident, generates investigation hypotheses, recommends what to investigate or change, and then measures the application again after the developer applies a fix. The final step is not a report. It is an experience that can be retrieved during a future investigation.

That last part is where I use Hindsight on GitHub.

I don't treat Hindsight as a generic chat-memory feature. I use it as the persistence layer for verified debugging experience: what happened, what I thought was happening, what I changed, what happened afterward, and what I should remember the next time a similar incident appears.

I wanted the debugging loop to continue after the recommendation

Most performance tooling is naturally organized around observation.

Collect CPU.

Collect memory.

Collect frame timing.

Show graphs.

Maybe identify an anomaly.

That is useful, but it leaves an important engineering question outside the system:

Did the fix actually work?

DevLens makes that question part of the core flow:

Target application
    ↓
Runtime telemetry
    ↓
Incident detection
    ↓
Evidence correlation
    ↓
Investigation
    ↓
Hypotheses + recommendation
    ↓
Developer applies fix
    ↓
Same workload runs again
    ↓
Before/after verification
    ↓
Investigation experience
    ↓
Future investigation

The repository specification is explicit that the system should not stop at AI-generated advice. It should compare the pre-fix and post-fix measurements and determine the outcome from those measurements.

That changes what "memory" means.

I don't want to remember that an LLM once said "move this work off the main thread."

I want to remember that a particular incident had high CPU and frame-time pressure, that the developer moved the expensive computation, and that the next run changed FPS from one measured value to another.

The distinction matters because a recommendation is a hypothesis. A verified intervention is evidence.

The experience object is more important than the answer

The Hindsight layer stores an Investigation Experience.

The structure described in the project looks roughly like this:

{
  "experience_id": "EXP-0012",
  "incident": {
    "type": "FRAME_DROP",
    "symptoms": [
      "FPS 59 → 23",
      "CPU 37% → 94%"
    ]
  },
  "initial_hypotheses": [
    "main-thread computation",
    "rendering workload"
  ],
  "recommended_action": "Move expensive computation off main thread",
  "developer_action": "Moved calculation to background worker",
  "before": {
    "fps": 23,
    "frame_time_ms": 43,
    "cpu_percent": 94
  },
  "after": {
    "fps": 56,
    "frame_time_ms": 17,
    "cpu_percent": 62
  },
  "outcome": "SUCCESS",
  "lesson": "CPU-heavy work was strongly associated with the incident."
}

There is a subtle but important difference between this and ordinary application logs.

A log says what happened.

An experience records the result of an investigation.

That means the system can preserve the reasoning context around an intervention rather than just retaining raw telemetry.

For a future incident, I can retrieve the previous experience and ask a more useful question:

"Is this incident similar enough that the previous result should affect the investigation?"

That is the model I follow with Hindsight's agent memory concepts: memory is useful when it gives an agent relevant context from previous interactions or experience, not merely when it stores more text.

A failed fix is not a missing success

Consider a deliberately simple case.

I detect a severe frame-drop incident:

Before
FPS:        24
Frame time: 41 ms
CPU:        93%

The investigation identifies expensive image processing as one possible cause.

I reduce the image-processing work.

Then I run the same workload:

After
FPS:        25
Frame time: 40 ms
CPU:        91%

The fix didn't materially change the problem.

A conventional workflow might record the new metrics and move on.

I don't want DevLens to do that.

The verification engine classifies outcomes explicitly:

SUCCESS
PARTIAL
FAILED
WORSE
INCONCLUSIVE

A failed intervention becomes a piece of evidence.

It doesn't prove that the hypothesis was universally wrong. It says that this intervention did not produce the expected improvement under this incident pattern.

That distinction is important when the next incident appears.

Suppose the new incident also has a frame drop and elevated CPU, but the memory signal is different. Hindsight can retrieve the failed experience. The investigation layer can then compare the two incidents instead of blindly repeating the old recommendation.

The prompt context can contain previous experiences with their outcomes:

CURRENT INCIDENT
...

PREVIOUS RELEVANT EXPERIENCES

Experience 1:
Incident: ...
Fix: ...
Outcome: SUCCESS

Experience 2:
Incident: ...
Fix: ...
Outcome: FAILED

TASK
Determine whether either experience is relevant.
Explain similarities, differences, and what should be tested now.

I like this pattern because it makes historical experience subordinate to current evidence.

The system does not say, "Last time we did X, so do X again."

It says, "Here is what happened last time. Decide whether it applies."

I made retrieval concrete instead of relying only on embeddings

Another design choice was to make the experience fingerprint explicit.

The repository describes a fingerprint based on fields such as incident type, severity, FPS degradation, frame-time range, CPU behavior, memory growth, jank rate, trigger, duration, and affected application component.

A simplified fingerprint might look like:

{
  "incident_type": "FRAME_DROP",
  "fps_drop_percent": 61,
  "cpu_spike": true,
  "memory_spike": false,
  "duration_seconds": 5,
  "trigger": "screen_transition"
}

For the initial design, similarity can be calculated deterministically.

For example:

same incident type        +30
similar FPS degradation   +20
similar CPU behavior      +20
similar memory behavior   +10
same trigger              +20

The resulting value is a retrieval similarity score, not a probability.

That distinction is worth preserving. A score like "82% similar" should not be presented as scientific certainty.

I also prefer this deterministic fingerprint as a first layer because it makes retrieval explainable. If a previous experience was retrieved because the incident type, CPU behavior, and trigger matched, I can tell an engineer why it appeared.

Embeddings can be added later if they improve retrieval. They should not be the only explanation for why a memory was surfaced.

Hindsight sits after verification, not before it

This is probably the most important placement decision in the architecture.

The current incident gets investigated using current evidence.

The developer applies a change.

The verification engine compares before and after.

Only then does the system create the persistent experience.

That ordering prevents the memory layer from becoming a repository of unverified guesses.

The project explicitly distinguishes the investigation from the verification process. The AI can recommend an action, but the recommendation is not considered successful simply because the model says it should work.

That gives me a clean boundary:

AI output
    ↓
Hypothesis / recommendation

Developer action
    ↓
Actual change

Verification
    ↓
Measured outcome

Hindsight
    ↓
Persistent experience

The result is a much stronger memory record.

This also makes the system safer to reason about. If an LLM produces an overconfident explanation, that explanation does not automatically become "truth" in memory. It has to survive contact with measurement.

The Hindsight documentation is useful here because it frames memory as something that can support future reasoning rather than simply replaying previous conversation text.

The rest of DevLens exists to make that memory trustworthy

Hindsight is not the performance detector.

I deliberately keep that responsibility outside the LLM and outside the memory layer.

Telemetry collection provides runtime facts: FPS, frame timing, CPU, memory, lifecycle events, and timestamps.

The incident detector uses deterministic rules:

IF FPS < 30 for N consecutive samples
THEN possible_frame_drop

IF frame_time > 33.3ms for N consecutive frames
THEN severe_jank

IF CPU > 85% for N seconds
THEN high_cpu

IF memory growth > threshold over window
THEN memory_growth

The evidence builder then aligns those measurements into a timeline.

Only after that does the investigation engine construct hypotheses.

This gives the AI a much narrower job: reason over structured evidence.

It can say:

Primary hypothesis:
Main-thread computational workload

Supporting evidence:
CPU increased from 37% to 94%.
Frame time increased from 17 ms to 43 ms.

Missing evidence:
Thread-level CPU attribution.

That is far more useful than feeding raw logs to a model and asking it to find something interesting.

The real value appears on the second incident

The first investigation is useful because it helps the developer understand a problem.

The second similar investigation is where the memory architecture starts paying off.

Imagine the first incident produced:

Incident:
FRAME_DROP

Evidence:
CPU spike
Large frame-time increase

Fix:
Move expensive computation away from frame-critical execution

Outcome:
SUCCESS

Later, another incident appears.

DevLens builds the current evidence timeline and searches previous experiences.

It finds the earlier investigation.

The new investigation now has another evidence source:

Current runtime evidence
+
Previous verified experience

But I still want the system to check differences.

Maybe the old incident happened during a screen transition and the new one happens during scrolling.

Maybe the old incident had no memory growth while the new one has substantial allocation pressure.

Maybe the previous fix succeeded because the workload was CPU-bound, while the new workload is rendering-bound.

Memory should inform the investigation, not replace it.

That is the behavior I want from Hindsight.

What I learned

1. A recommendation is not an outcome

This is the easiest mistake to make in an AI-assisted engineering tool.

A model can produce a plausible recommendation in seconds.

That doesn't mean the recommendation worked.

I now treat verification as a first-class system component rather than a final UI screen.

2. Failed interventions deserve persistent storage

A failed fix tells me what not to repeat blindly.

It can also expose weaknesses in the original hypothesis.

Deleting that information guarantees that future investigations start with less context than the system already earned.

3. Memory needs structure

Storing an entire investigation as an unstructured blob makes future retrieval difficult to explain.

Incident type, metrics, hypotheses, actions, outcomes, and lessons give the memory system something concrete to retrieve and compare.

4. Historical evidence should never override current evidence

A previous successful fix is not a universal solution.

The current incident still has to earn its diagnosis from current telemetry.

Hindsight provides context.

It does not provide certainty.

5. The best debugging loop ends with knowledge, not a chart

The useful artifact after an investigation isn't only a graph.

It is a verified statement about what happened after a particular intervention.

That is what I want DevLens to carry forward.

The project started as an Android performance investigation system, but the architectural lesson is broader.

When I combine deterministic measurement, structured evidence, AI reasoning, verification, and persistent experience, I get something different from a chatbot attached to a dashboard.

I get a loop:

Observe
  ↓
Investigate
  ↓
Change
  ↓
Measure
  ↓
Remember
  ↓
Investigate better next time

For me, that last transition is the reason Hindsight belongs in the architecture.

The most useful memory isn't necessarily the answer the system generated.

Sometimes it is the fix that failed.

I Made Verification More Important Than the Recommendation

A performance recommendation is easy to generate. Proving that it worked is much harder.

That became one of the core design decisions behind DevLens.

I built DevLens as an Android performance investigator that observes runtime behavior, detects incidents, correlates evidence, generates hypotheses, recommends what to investigate, and then runs the same workload again after a developer changes the application.

The important part is what happens after the recommendation.

I don't consider the problem solved because an AI explanation sounds convincing.

I consider it solved only when the measurements support the intervention.

That decision also determines what I store in Hindsight.

The system is an investigation loop, not a recommendation engine

The basic flow is deliberately straightforward:

Target Android App
    ↓
Runtime Evidence
    ↓
Incident Detection
    ↓
Evidence Correlation
    ↓
AI Investigation
    ↓
Hypotheses + Recommended Action
    ↓
Developer Applies Fix
    ↓
Re-run Same Workload
    ↓
Before/After Comparison
    ↓
Outcome
    ↓
Hindsight Experience

Each stage has a different responsibility.

Telemetry collection measures the application.

Incident detection decides whether a measurable anomaly occurred.

Evidence correlation constructs the context around that anomaly.

The AI investigation layer reasons over that context.

The developer decides what change to make.

Verification measures the consequence.

Hindsight stores the verified experience.

I find this separation useful because it prevents one component from becoming responsible for everything.

In particular, the LLM doesn't decide whether the application actually improved.

I don't ask an LLM whether 57 FPS is better than 23 FPS

That sounds almost too obvious to say, but it is an important architectural boundary.

If DevLens has:

Before
FPS: 23
Frame time: 43 ms
CPU: 94%

After
FPS: 57
Frame time: 17 ms
CPU: 63%

there is no reason to ask a language model whether performance improved.

The system already has the data.

The comparison engine can calculate the changes directly:

FPS improvement: +147%
Frame-time reduction: -60%
CPU reduction: -33%

The project defines explicit outcome classes:

SUCCESS
PARTIAL
FAILED
WORSE
INCONCLUSIVE

The exact thresholds can be configured.

That means the numerical decision remains deterministic.

The LLM can explain the result, suggest what to investigate next, or reason about whether the observed changes support a particular hypothesis.

But it should not be the authority for arithmetic.

This is the same principle I use elsewhere in the architecture: measurements and threshold calculations belong in code; reasoning about those measurements can belong to the model.

The before/after boundary is where the system becomes interesting

Suppose the incident detector identifies:

FPS:        24
Frame time: 41 ms
CPU:        93%

The investigation engine considers several hypotheses.

One of them is expensive main-thread computation.

The recommendation might be:

Profile the expensive operation executed during the rendering event.
Move non-UI computation away from the main thread if confirmed.

That recommendation is deliberately phrased as an investigation action, not a magical diagnosis.

The developer then changes the application.

The same workload runs again.

If the result is:

FPS:        57
Frame time: 17 ms
CPU:        63%

the verification engine has evidence that the intervention was effective under the tested scenario.

But suppose the result is:

FPS:        25
Frame time: 40 ms
CPU:        91%

The recommendation didn't materially improve the problem.

That is not a failure of the verification system.

It is exactly the kind of information the verification system exists to expose.

The system should preserve that outcome.

Hindsight turns verification into engineering memory

This is where I use Hindsight on GitHub.

A completed investigation becomes an Investigation Experience containing the incident, evidence, hypotheses, recommended fix, developer action, before metrics, after metrics, outcome, and lesson.

A simplified experience looks like:

{
  "incident": {
    "type": "FRAME_DROP",
    "symptoms": [
      "FPS 59 → 23",
      "CPU 37% → 94%"
    ]
  },
  "initial_hypotheses": [
    "main-thread computation",
    "rendering workload"
  ],
  "recommended_action": "Move expensive computation off main thread",
  "developer_action": "Moved calculation to background worker",
  "before": {
    "fps": 23,
    "frame_time_ms": 43,
    "cpu_percent": 94
  },
  "after": {
    "fps": 56,
    "frame_time_ms": 17,
    "cpu_percent": 62
  },
  "outcome": "SUCCESS"
}

The important field isn't necessarily the recommendation.

It is the outcome.

I can now retrieve a previous investigation and distinguish between:

"This was suggested."

and:

"This was suggested, implemented, measured, and it worked."

Those are very different kinds of information.

The second one is what I want Hindsight to carry forward.

The Hindsight documentation describes the broader memory problem well: an agent becomes more useful when relevant prior experience can inform later reasoning. For DevLens, the prior experience isn't just a conversation. It is an engineering intervention tied to measured runtime behavior.

Failed fixes become useful evidence

The most interesting case is a failed fix.

Imagine the system identifies memory pressure as a possible cause.

The developer reduces allocations.

The next run produces almost the same performance:

Before:
FPS: 24
CPU: 92%
Memory: 610 MB

After:
FPS: 25
CPU: 91%
Memory: 590 MB

Memory improved.

FPS barely did.

That should not be turned into a success story just because one metric moved in the expected direction.

The outcome could be PARTIAL or FAILED depending on the configured criteria.

Now Hindsight has something useful to retrieve later.

The previous experience says, in effect:

"Reducing memory pressure changed memory usage, but it did not materially resolve this frame-drop pattern."

That is more valuable than simply storing:

"Memory pressure was suspected."

The latter describes a hypothesis.

The former describes what happened when the hypothesis was tested.

This is why I made verification precede persistent experience.

I also wanted Hindsight retrieval to be explainable

A memory system can become difficult to trust if engineers cannot understand why a previous experience was retrieved.

The project uses a deterministic incident fingerprint as a first retrieval mechanism.

The fingerprint can include:

incident type
severity
FPS degradation
frame-time range
CPU spike
memory growth
jank rate
trigger/event
duration
application component

For example:

{
  "incident_type": "FRAME_DROP",
  "fps_drop_percent": 61,
  "cpu_spike": true,
  "memory_spike": false,
  "duration_seconds": 5,
  "trigger": "screen_transition"
}

A simple similarity score can then weight matching fields.

The repository describes an example weighting:

same incident type        +30
similar FPS degradation   +20
similar CPU behavior      +20
similar memory behavior   +10
same trigger              +20

This isn't a probability model.

It is retrieval logic.

That distinction matters.

If I tell an engineer that an experience was retrieved because the incident type, CPU behavior, and trigger matched, they can reason about whether that historical evidence is relevant.

I can later add embeddings if they solve a real retrieval problem, but I don't want a black-box similarity score to become the foundation of the system before I understand the simpler case.

The AI still matters, but it has a narrower job

Verification doesn't make the AI unnecessary.

It makes its role clearer.

The model receives structured evidence instead of uncontrolled telemetry.

For example:

{
  "summary": "The incident is primarily associated with high CPU workload.",
  "hypotheses": [
    {
      "cause": "Main-thread computation",
      "support": [
        "CPU increased from 37% to 94%",
        "frame time increased during the CPU spike"
      ],
      "contradictions": [],
      "confidence_label": "supported"
    }
  ],
  "missing_evidence": [
    "Thread-level CPU attribution"
  ],
  "recommended_action": "Profile the main thread during the incident.",
  "verification_metric": "frame time and FPS"
}

I want the model to separate observed evidence from inference and missing evidence.

That matters because a correlation is not automatically causation.

If CPU rises at the same time as frame time, that is useful evidence.

It isn't proof of causality.

The investigation engine can therefore generate multiple hypotheses.

For a frame-drop incident, it may consider:

H1: Main-thread CPU workload
H2: Memory allocation / GC pressure
H3: Rendering workload
H4: I/O or blocking operation

Each hypothesis can have supporting evidence, contradicting evidence, missing evidence, and a recommended test.

That structure gives verification something concrete to measure.

I designed the demo workload to make verification reproducible

The target application is deliberately controlled.

Instead of relying on an arbitrary Android application to happen to produce a particular performance incident, the architecture provides a DevLens target with reproducible workloads:

Normal Mode
CPU Stress
Memory Stress
Rendering Stress
Combined Incident
Recovery / Fixed Version

This matters for verification because I want the before and after runs to be comparable.

The ideal sequence is:

Normal
  ↓
Trigger known workload
  ↓
Incident detected
  ↓
Investigation
  ↓
Apply change
  ↓
Run same workload
  ↓
Compare

If the workload changes between runs, the comparison becomes much weaker.

The controlled target also makes testing easier. I can deliberately create CPU pressure, memory growth, rendering pressure, or a combination and verify that the collection, detection, evidence, and comparison layers behave consistently.

The architecture protects the verification boundary

There are several places where I intentionally avoid asking AI to make decisions that code can make.

The incident detector is deterministic.

The telemetry calculations are deterministic.

The before/after comparison is deterministic.

The outcome classification is deterministic.

The AI handles investigation and explanation.

Hindsight handles persistent experience.

That separation makes the architecture easier to test.

I can unit-test FPS calculations.

I can test incident thresholds.

I can test similarity scoring.

I can test outcome classification.

Then I can separately evaluate whether the AI generated hypotheses that are actually supported by the evidence.

The system doesn't have to be correct everywhere at once.

Each boundary has a contract.

What I learned

1. Verification deserves first-class architecture

It is tempting to make verification a final UI screen after the "interesting" AI work.

I think that is backwards.

If the recommendation isn't tested, I don't know whether it helped.

2. The most useful memory is outcome-aware

A previous suggestion is weak historical context.

A previous suggestion plus the developer's action plus measured before/after results is much stronger.

3. Failed fixes are valuable

A failed intervention narrows the search space.

It tells me what happened when a particular hypothesis was tested under a particular workload.

That information should survive.

4. Deterministic code should own measurable truth

If I can calculate it from the telemetry, I shouldn't outsource the calculation to a language model.

5. Historical experience should influence, not dictate

A previous success is evidence, not a rule.

The current incident still needs to be understood on its own terms.

That is the design I ended up with:

Evidence
  ↓
Hypothesis
  ↓
Recommendation
  ↓
Developer action
  ↓
Measurement
  ↓
Outcome
  ↓
Hindsight
  ↓
Better context next time

For me, the important shift was simple.

I stopped thinking of DevLens as a system that produces performance recommendations.

I started thinking of it as a system that tests engineering decisions and remembers the results.

That makes the recommendation only one step in the process.

The real artifact is what happened after we tried it.

The LLM Wasn't the Performance Detector

The interesting part of DevLens isn't that I put an LLM next to Android performance metrics. The interesting part is deciding exactly where the model is allowed to reason.

I built DevLens as an Android performance investigation system. It collects runtime evidence, detects performance incidents, correlates telemetry around those incidents, generates hypotheses, recommends what to investigate, verifies the result after a change, and stores the outcome for future investigations.

The architectural rule that shaped the whole system is simple:

I don't use the LLM to decide what the measurements mean numerically. I use deterministic code to establish facts and the model to reason about those facts.

That sounds like a small implementation detail.

It isn't.

It determines the data flow, the testing strategy, the prompt design, and the role of Hindsight.

Start with what the system can actually observe

Android performance problems rarely arrive as a clean error message.

Instead, I might see:

FPS ↓
CPU ↑
Memory ↑
Jank ↑
Frame time ↑

Those signals can be collected independently, but the hard problem is understanding their relationship.

A snapshot like this:

FPS = 23
CPU = 94%

is not enough to prove that CPU caused the frame drop.

I need the timeline.

DevLens therefore starts with runtime telemetry such as FPS and frame timing, CPU usage, memory usage, application lifecycle events, timestamps, and application/package information.

Every sample has a timestamp.

A representative telemetry object is:

{
  "timestamp": 1790600000123,
  "fps": 24.3,
  "frame_time_ms": 41.2,
  "cpu_percent": 91.4,
  "memory_mb": 612,
  "memory_percent": 76.1,
  "jank": true
}

The exact metrics depend on Android APIs and the target application, but the architectural requirement is consistent: measure real runtime behavior rather than fabricate a convenient story around it.

The incident detector is intentionally boring

I like boring code when the problem is deterministic.

The incident detector can use rules such as:

IF FPS < 30 for N consecutive samples
THEN possible_frame_drop

IF frame_time > 33.3ms for N consecutive frames
THEN severe_jank

IF CPU > 85% for N seconds
THEN high_cpu

IF memory growth > threshold over window
THEN memory_growth

IF multiple conditions overlap
THEN correlated_performance_incident

There is no reason to involve an LLM here.

If FPS is 23 and the configured threshold is 30, code can determine that the threshold was crossed.

If frame time remains above 33.3 ms for the required number of frames, code can determine that a severe-jank condition occurred.

This gives the system a reproducible foundation.

The model isn't asked to inspect a thousand numbers and decide which ones look suspicious.

Instead, the pipeline becomes:

Raw telemetry
    ↓
Deterministic processing
    ↓
Incident detection
    ↓
Evidence extraction
    ↓
Structured investigation context
    ↓
LLM

The LLM arrives after the system knows what happened.

Evidence correlation is the bridge

The next layer is the part I consider especially important.

Suppose the telemetry looks like:

t=1000   FPS 59   CPU 35   Memory 420
t=2000   FPS 51   CPU 62   Memory 440
t=3000   FPS 32   CPU 86   Memory 510
t=4000   FPS 23   CPU 94   Memory 610

The evidence processor can derive useful facts:

FPS decrease: 61%
CPU increase: 169%
Memory increase: 45%

More importantly, it can describe temporal relationships.

For example:

{
  "type": "CORRELATION",
  "statement": "CPU rose above 90% within 1.2 seconds of the frame-time increase"
}

That is much more useful to the investigation layer than simply passing the raw samples through.

The system can also include different evidence types:

METRIC
EVENT
TIMELINE
CORRELATION
BASELINE_COMPARISON
PREVIOUS_EXPERIENCE
DEVELOPER_ANNOTATION

That vocabulary gives the model a structured context.

The model's job is to generate competing explanations

Once the evidence is structured, the LLM can do something that deterministic thresholds aren't good at: reason about plausible causes.

For a severe frame-drop incident:

Incident:
Severe frame drop

Evidence:
- FPS fell 59 → 23
- frame time rose 17ms → 43ms
- CPU rose 37% → 94%
- memory rose moderately

The investigation engine can consider:

H1:
Main-thread CPU workload

H2:
Memory allocation / GC pressure

H3:
Rendering workload

H4:
I/O or blocking operation

Each hypothesis can contain:

{
  "id": "H1",
  "cause": "High main-thread computation",
  "supporting_evidence": [],
  "contradicting_evidence": [],
  "missing_evidence": [],
  "recommended_test": ""
}

That structure matters because I don't want the model to collapse uncertainty into one confident sentence.

A useful investigation can say:

"CPU pressure is strongly associated with the incident, but thread-level attribution is missing."

That is a better engineering statement than:

"CPU caused the frame drop."

The difference is that the first statement identifies both evidence and uncertainty.

I keep the LLM away from raw uncontrolled logs

The repository explicitly describes a reduction step:

1000 raw samples
       ↓
Evidence processor
       ↓
20 meaningful facts
       ↓
LLM

That is a practical design choice.

Sending the entire telemetry history into the model makes the prompt larger without necessarily making the reasoning better.

More importantly, it gives the model more opportunity to invent relationships that weren't actually established.

I want the evidence processor to do the mechanical work first.

Normalize timestamps.

Calculate baselines.

Identify peaks.

Calculate changes.

Identify overlaps.

Extract relevant events.

Then pass those facts into the model.

The model should reason over evidence, not reconstruct the evidence pipeline itself.

Structured output makes the boundary testable

I also avoid relying on free-form AI text alone.

The intended response shape is closer to:

{
  "summary": "The incident is primarily associated with high CPU workload.",
  "hypotheses": [
    {
      "cause": "Main-thread computation",
      "support": [
        "CPU increased from 37% to 94%",
        "frame time increased during the CPU spike"
      ],
      "contradictions": [],
      "confidence_label": "supported"
    }
  ],
  "missing_evidence": [
    "Thread-level CPU attribution"
  ],
  "recommended_action": "Profile the main thread during the incident.",
  "verification_metric": "frame time and FPS"
}

The application can validate that response before displaying it.

This also makes testing more manageable.

I can test whether the parser handles malformed output.

I can check whether evidence fields exist.

I can ensure recommendations contain the expected structure.

I can separately evaluate the quality of the hypotheses.

Again, the system is divided into contracts instead of one giant "AI does debugging" function.

Hindsight enters after the reasoning has been tested

This is where Hindsight on GitHub becomes important.

I don't want Hindsight to remember every speculative thought the model produced.

I want it to remember the investigation after the developer has had a chance to test the recommendation.

That produces an experience containing:

Incident
Evidence
Hypotheses
Recommended fix
Developer action
Before metrics
After metrics
Outcome
Lesson

A successful experience might record:

Before:
FPS 23
Frame time 43ms
CPU 94%

Action:
Move expensive computation away from frame-critical execution

After:
FPS 56
Frame time 17ms
CPU 62%

Outcome:
SUCCESS

A failed experience can be equally useful:

Before:
FPS 24
Frame time 41ms
CPU 93%

Action:
Reduce image processing

After:
FPS 25
Frame time 40ms
CPU 91%

Outcome:
FAILED

That experience becomes historical evidence.

The next investigation can retrieve similar experiences and present them to the reasoning layer.

This is the part of agent memory from Vectorize that fits the project particularly well: memory is useful when previous experience can influence a later reasoning process.

For DevLens, "previous experience" has a concrete meaning.

It is a performance incident that was actually investigated and measured.

Retrieval is based on incident characteristics

The current incident can be converted into a fingerprint:

{
  "incident_type": "FRAME_DROP",
  "fps_drop_percent": 61,
  "cpu_spike": true,
  "memory_spike": false,
  "duration_seconds": 5,
  "trigger": "screen_transition"
}

The repository describes a deterministic similarity approach:

same incident type        +30
similar FPS degradation   +20
similar CPU behavior      +20
similar memory behavior   +10
same trigger              +20

This isn't presented as a probability.

It is a retrieval score.

I prefer that distinction because it keeps the system honest.

If a previous experience is retrieved, I can explain which characteristics matched.

I can also compare the differences before allowing the historical experience to influence the current investigation.

The historical fix is not a command.

It is context.

Verification closes the loop

The investigation engine might recommend:

Profile the expensive operation executed during the rendering event.
Move non-UI computation away from the main thread if confirmed.

The developer applies the change.

The workload runs again.

The comparison engine measures the new state.

Only then does Hindsight receive the completed experience.

That gives the architecture a useful separation:

Measurement
    ↓
Facts

AI reasoning
    ↓
Hypotheses

Developer action
    ↓
Intervention

Verification
    ↓
Outcome

Hindsight
    ↓
Persistent experience

This is also why I don't claim that DevLens "learns" in some vague sense.

The precise statement is that it stores verified investigation experiences and retrieves relevant previous outcomes during future investigations.

That wording matters.

It describes a mechanism.

A controlled target makes the whole pipeline testable

The project uses a controlled Android target with reproducible workloads such as CPU stress, memory stress, rendering stress, and combined incidents.

I made that decision because universal profiling is a much larger problem than this system needs to solve.

A controlled workload gives me a repeatable sequence:

Normal
  ↓
Trigger workload
  ↓
Collect telemetry
  ↓
Detect incident
  ↓
Build evidence
  ↓
Investigate
  ↓
Apply fix
  ↓
Run same workload
  ↓
Verify
  ↓
Store experience

That makes the entire pipeline easier to reason about.

If detection fails, I can reproduce the incident.

If evidence correlation is wrong, I can inspect the same timeline.

If the AI invents evidence, I can compare its output with the structured context.

If verification misclassifies the outcome, I can test the comparison engine independently.

The model is no longer hiding system behavior behind one opaque call.

What I learned

1. Don't use an LLM for deterministic work

If code can measure it, threshold it, compare it, or calculate it, I let code do that.

The LLM is more useful when it has to reason about ambiguity.

2. Context preparation is part of AI engineering

The quality of the evidence supplied to the model matters as much as the model prompt.

Reducing thousands of raw samples into a small set of validated facts makes the investigation easier to inspect and test.

3. Uncertainty is a useful output

A good investigation can identify missing evidence instead of manufacturing certainty.

"Thread-level attribution is missing" is often more useful than a confident but unsupported root-cause claim.

4. Memory should contain consequences

Hindsight becomes much more valuable when the stored experience includes what happened after the developer acted.

A recommendation alone is weak memory.

A recommendation plus verification is engineering history.

5. Architecture determines how much I can trust the AI

I don't need the model to be correct about everything.

I need the surrounding system to constrain what it is allowed to claim, provide evidence it can actually inspect, and verify consequences afterward.

That is the architecture I ended up with:

Real runtime evidence
        ↓
Deterministic incident detection
        ↓
Evidence correlation
        ↓
AI investigation
        ↓
Developer action
        ↓
Deterministic verification
        ↓
Hindsight experience
        ↓
Future investigation

The result is not a profiler replacement, and it isn't a chatbot with performance charts.

It is an investigation layer around application performance evidence.

The model is one component.

The measurements are another.

The verification loop is another.

And Hindsight gives the system a way to carry verified experience from one investigation into the next.

For me, that separation is the most important design decision in the entire system.

The LLM doesn't need to know everything.

It needs to know what the system has actually observed, what remains uncertain, and what happened the last time we tried something similar.

I Stopped Treating CPU and FPS as Separate Numbers

The hardest part of Android performance debugging isn't collecting CPU or FPS. It's understanding what changed first, what changed with it, and what happened after I tried to fix it.

That became the central idea behind DevLens.

I built DevLens as an Android performance investigation system rather than another dashboard. It collects runtime evidence, detects incidents, builds a timeline around them, investigates possible causes, verifies a developer's fix, and stores the result as experience for future investigations.

The important shift was moving from metric watching to evidence correlation.

A performance snapshot is not an explanation

Consider this:

FPS: 23
CPU: 94%

It's tempting to conclude that the CPU spike caused the frame drop.

But those two numbers don't establish a causal relationship.

Maybe CPU increased because a rendering operation started.

Maybe memory pressure triggered additional work.

Maybe an application event caused several expensive operations at once.

Maybe the CPU spike happened after the frame-rate degradation had already started.

Without time, the relationship is ambiguous.

DevLens therefore treats timestamps as first-class data.

A representative timeline can look like:

10:31:05.120
User started level loading

10:31:05.500
CPU: 42%
FPS: 59

10:31:06.200
CPU: 71%
Frame time: 21 ms

10:31:06.700
CPU: 94%
Frame time: 42 ms
FPS: 23

10:31:07.100
GC event detected

10:31:07.400
Memory: 78%

Now I have something to investigate.

The question isn't just "which number is bad?"

It becomes:

Which signal changed first?

Which signals changed together?

How long did the degradation last?

Did an application event precede it?

Did memory growth overlap with the frame-time increase?

Did a GC event occur close to the incident?

Did the CPU remain high after the frame-rate recovered?

Those questions are much closer to how an engineer actually investigates performance.

The telemetry layer is deliberately simple

The project collects runtime signals such as:

FPS / frame timing
Jank / slow frames
CPU usage
Memory usage
Application lifecycle events
Timestamps
Application/package information

The telemetry object has a timestamp and measured values:

{
  "timestamp": 1790600000123,
  "fps": 24.3,
  "frame_time_ms": 41.2,
  "cpu_percent": 91.4,
  "memory_mb": 612,
  "memory_percent": 76.1,
  "jank": true
}

The exact metrics depend on what Android exposes for the target application and version.

That limitation is important.

I don't want to silently substitute fabricated values when a metric isn't available.

If exact process CPU measurement isn't consistently available on a particular configuration, the correct behavior is to document that limitation.

The same applies to frame timing and memory.

A performance investigation system is only useful if engineers can trust what it says it measured.

I use deterministic detection before any AI reasoning

Once the telemetry exists, DevLens identifies incidents with deterministic rules.

For example:

IF FPS < 30 for N consecutive samples
THEN possible_frame_drop

IF frame_time > 33.3ms for N consecutive frames
THEN severe_jank

IF CPU > 85% for N seconds
THEN high_cpu

IF memory growth > threshold over window
THEN memory_growth

The LLM does not decide whether 23 FPS is "low."

Code does.

That separation gives me a clean boundary between measurement and interpretation.

The incident detector can produce an object like:

{
  "incident_id": "INC-0007",
  "package": "com.devlens.demo",
  "start_time": 1790600000000,
  "end_time": 1790600005000,
  "type": "FRAME_DROP",
  "severity": "HIGH",
  "baseline": {
    "fps": 59.2,
    "cpu_percent": 37.1,
    "memory_mb": 421
  },
  "peak": {
    "fps": 22.7,
    "cpu_percent": 94.3,
    "memory_mb": 608
  }
}

Now the system knows what incident it is investigating.

The next job is to understand its context.

Evidence correlation turns measurements into an investigation

Suppose the telemetry samples are:

Time 1000:
FPS 59
CPU 35
Memory 420

Time 2000:
FPS 51
CPU 62
Memory 440

Time 3000:
FPS 32
CPU 86
Memory 510

Time 4000:
FPS 23
CPU 94
Memory 610

I can calculate:

FPS decrease: 61%
CPU increase: 169%
Memory increase: 45%

But the more interesting output is temporal.

The evidence layer can describe relationships such as:

{
  "type": "CORRELATION",
  "statement": "CPU rose above 90% within 1.2 seconds of the frame-time increase"
}

That becomes an evidence item rather than an unsupported conclusion.

The evidence vocabulary in the project includes:

METRIC
EVENT
TIMELINE
CORRELATION
BASELINE_COMPARISON
PREVIOUS_EXPERIENCE
DEVELOPER_ANNOTATION

This is a small detail with a large effect on the rest of the architecture.

Instead of asking the model to interpret raw telemetry, I give it structured evidence.

The investigation engine should keep multiple hypotheses alive

A frame drop with high CPU might be caused by several things.

DevLens can consider:

Main-thread computational workload
Memory allocation / GC pressure
Rendering workload
I/O or blocking operation

Each hypothesis can carry:

{
  "id": "H1",
  "cause": "High main-thread computation",
  "supporting_evidence": [],
  "contradicting_evidence": [],
  "missing_evidence": [],
  "recommended_test": ""
}

I prefer this to a single root-cause sentence.

For example:

Primary hypothesis:
Main-thread computational workload

Supporting evidence:
CPU increased from 37% to 94%.
Frame time increased during the CPU spike.

Secondary hypothesis:
Rendering workload

Missing evidence:
Thread-level CPU attribution.

That result tells me both what the system sees and what it doesn't see.

The distinction matters because correlation is not causation.

If CPU rises at almost the same time as frame time, that is meaningful.

It isn't proof that CPU caused the frame drop.

The investigation layer should preserve that uncertainty.

Hindsight adds time depth to the evidence

This is where Hindsight on GitHub becomes a major part of the architecture.

Current evidence tells me what is happening now.

Hindsight tells me what happened when I encountered something similar before.

The project stores an Investigation Experience containing:

incident
evidence
initial hypotheses
recommended fix
developer action
before metrics
after metrics
outcome
lesson

That lets a future investigation include previous experience as another evidence source.

The concept is closely related to agent memory from Vectorize: an agent can use relevant prior experience to make future reasoning more contextual.

But I don't want generic memory.

I want performance-specific experience.

For example:

Previous incident:
FRAME_DROP

Previous evidence:
CPU increased sharply.
Frame time increased with it.

Previous intervention:
Move expensive computation away from frame-critical execution.

Previous outcome:
SUCCESS

A future incident can retrieve that experience and ask whether it actually resembles the current one.

That is different from simply replaying an old answer.

I use fingerprints before making retrieval complicated

The project describes a deterministic incident fingerprint:

{
  "incident_type": "FRAME_DROP",
  "fps_drop_percent": 61,
  "cpu_spike": true,
  "memory_spike": false,
  "duration_seconds": 5,
  "trigger": "screen_transition"
}

Similarity can initially be scored with explicit weights:

same incident type        +30
similar FPS degradation   +20
similar CPU behavior      +20
similar memory behavior   +10
same trigger              +20

The resulting number is a similarity score.

It is not a probability.

I think that distinction is important because retrieval systems can otherwise look more precise than they really are.

If the system says that a previous experience is "82% similar," I want engineers to understand that this means the fingerprint matched according to a scoring function.

It doesn't mean there is an 82% chance that the same fix will work.

That previous experience still needs to be compared with the current evidence.

The controlled target makes correlation testable

The system uses a controlled target application because performance incidents need to be reproducible.

The target can deliberately produce workloads such as:

Normal Mode
CPU Stress
Memory Stress
Rendering Stress
Combined Incident
Recovery / Fixed Version

That lets me execute a known sequence:

Normal
  ↓
Rendering stress
  ↓
FPS drops
  ↓
Frame time increases
  ↓
Incident detected
  ↓
Evidence correlated
  ↓
Investigation

This is much more useful for engineering the system than waiting for an arbitrary application to randomly produce the right combination of signals.

It also lets me test the entire loop repeatedly.

If the incident doesn't trigger, I know where to look.

If the timeline is wrong, I can reproduce it.

If the evidence processor claims a correlation that isn't present, I can inspect the underlying samples.

If the investigation produces a hypothesis unsupported by the evidence, I can compare the prompt context with the generated response.

Reproducibility makes the system debuggable.

Verification makes correlation more than an explanation

There is another important part of the loop.

After the investigation, the developer changes the application.

The same workload runs again.

Suppose:

Before
FPS: 22
Frame time: 45 ms
CPU: 92%

After
FPS: 57
Frame time: 17 ms
CPU: 61%

The verification engine calculates the changes.

The result can be classified as:

SUCCESS
PARTIAL
FAILED
WORSE
INCONCLUSIVE

That outcome then becomes part of the Hindsight experience.

This matters because historical experience should contain consequences, not just theories.

A future incident can retrieve:

Current evidence
+
Previous incident
+
Previous intervention
+
Previous outcome

The AI can then reason about whether the old experience should influence the current investigation.

That creates a feedback loop:

Current telemetry
      ↓
Current incident
      ↓
Current evidence
      +
Previous experiences
      ↓
Investigation
      ↓
Developer action
      ↓
Verification
      ↓
New experience

The system gets better context over time without pretending that every previous solution is universally correct.

The interesting part is what Hindsight remembers

I don't want to store everything.

I want to store what became meaningful after an investigation.

That means the experience includes the intervention and its measured consequence.

A failed fix is especially useful.

Suppose the system previously recommended reducing image processing.

The developer tried it.

FPS went from 24 to 25.

Frame time went from 41 ms to 40 ms.

The fix failed to materially address the incident.

That experience can be retrieved later.

It gives the investigation engine evidence that this particular intervention did not work for a similar incident.

The Hindsight documentation is relevant to this architecture because the value of memory comes from making prior experience available when it is useful, not merely storing more historical text.

What I learned

1. Performance debugging is temporal

A metric without a timeline is often incomplete evidence.

The order and overlap of changes matter.

2. Correlation should be explicit

I want the system to say that two signals changed near each other, rather than silently turning that relationship into a causal claim.

3. Deterministic detection makes AI reasoning more defensible

The model should receive an incident that the system has already measured and identified, not raw telemetry that it has to interpret from scratch.

4. Memory becomes useful when it includes outcomes

Knowing what someone previously suspected is less useful than knowing what they actually changed and what happened afterward.

5. Reproducibility is part of performance tooling

A controlled workload isn't just convenient for testing.

It makes before/after verification meaningful.

The overall architecture I ended up with is therefore less like a dashboard and more like a chain of evidence:

Runtime telemetry
      ↓
Incident detection
      ↓
Evidence timeline
      ↓
Hypotheses
      ↓
Recommended investigation
      ↓
Developer action
      ↓
Before/after measurement
      ↓
Outcome
      ↓
Hindsight experience
      ↓
Future investigation

The useful unit isn't CPU.

It isn't FPS.

It isn't even the incident.

The useful unit is the investigation: what happened, what I thought was happening, what I changed, what the measurements showed afterward, and what I should remember when something similar happens again.

That is the reason I stopped treating CPU and FPS as separate numbers.

They are pieces of the same timeline.

Hindsight Changed What I Considered a Useful Debugging Result

I used to think the useful output of a debugging system was the diagnosis.

If I could tell an engineer, "This looks like main-thread CPU pressure," I had done something useful.

While designing DevLens, I changed my mind.

A diagnosis is only one point in the debugging process. The more useful result is a verified record of what happened after we acted on that diagnosis.

That is why Hindsight became a major part of the system.

DevLens is an Android performance investigator. It observes a target application, detects performance incidents, correlates runtime evidence, generates competing hypotheses, recommends an investigation or fix, measures the application again, and stores the resulting experience so a future investigation can use it.

The system is designed around a simple loop:

Observe
  ↓
Investigate
  ↓
Act
  ↓
Verify
  ↓
Remember
  ↓
Investigate again

Hindsight is the "remember" step.

I wanted memory to represent engineering experience

There is a temptation when building an AI system to call every persistence mechanism "memory."

That is too broad for what I wanted.

For DevLens, memory has a specific shape.

An Investigation Experience records:

Incident
Evidence
Hypotheses
Recommended fix
Developer action
Before metrics
After metrics
Outcome
Lesson

The experience schema described in the project is roughly:

{
  "experience_id": "EXP-0012",
  "incident": {
    "type": "FRAME_DROP",
    "symptoms": [
      "FPS 59 → 23",
      "CPU 37% → 94%"
    ]
  },
  "initial_hypotheses": [
    "main-thread computation",
    "rendering workload"
  ],
  "recommended_action": "Move expensive computation off main thread",
  "developer_action": "Moved calculation to background worker",
  "before": {
    "fps": 23,
    "frame_time_ms": 43,
    "cpu_percent": 94
  },
  "after": {
    "fps": 56,
    "frame_time_ms": 17,
    "cpu_percent": 62
  },
  "outcome": "SUCCESS",
  "lesson": "The incident was strongly associated with CPU-heavy work."
}

This is not just a transcript.

It is an engineering event with a measured consequence.

That difference is the reason I think the memory layer matters.

The first investigation is useful. The second is where memory earns its place.

Imagine DevLens sees a frame-drop incident.

The runtime evidence says:

FPS: 59 → 23
Frame time: 17 ms → 43 ms
CPU: 37% → 94%
Memory: moderate increase

The investigation engine generates several hypotheses:

H1: Main-thread computation
H2: Rendering workload
H3: Memory allocation / GC pressure
H4: I/O or blocking operation

The system identifies the strongest available evidence and produces a recommended investigation.

The developer changes the application.

Verification shows:

Before:
FPS 23
Frame time 43 ms
CPU 94%

After:
FPS 56
Frame time 17 ms
CPU 62%

Now there is a verified experience.

Months later, another incident looks similar.

Without memory, I have to start from scratch.

With Hindsight, the new investigation can retrieve the earlier experience.

That means the context is now:

Current runtime evidence
+
Current incident
+
Previous verified experience

The previous experience doesn't dictate the answer.

It gives the investigation another source of evidence.

That is the behavior I wanted.

I didn't want Hindsight to become a bag of guesses

This is why the ordering matters.

The system doesn't immediately save every AI-generated hypothesis as a durable lesson.

The flow is:

Telemetry
    ↓
Incident
    ↓
Evidence
    ↓
AI hypotheses
    ↓
Recommendation
    ↓
Developer action
    ↓
Verification
    ↓
Experience

The persistent experience comes after the intervention has been measured.

This gives the memory layer a useful quality filter.

A model can produce a plausible explanation.

The developer can try the recommended change.

The verification engine can discover that nothing improved.

That failed result is then part of the historical experience.

The Hindsight documentation provides useful context for this model of memory: previous experience becomes useful when it can be retrieved and used during future reasoning.

For DevLens, the experience isn't merely something the model said.

It includes what happened after the model said it.

The failed fix is often more interesting than the successful one

Suppose the initial hypothesis is memory pressure.

The developer reduces allocations.

The next run produces:

Before
FPS: 24
Memory: 610 MB
CPU: 92%

After
FPS: 25
Memory: 590 MB
CPU: 91%

One metric improved.

The performance problem didn't.

That should not become a "successful optimization."

It should become an outcome that constrains future reasoning.

The experience can record:

Hypothesis:
Memory pressure

Action:
Reduce allocations

Outcome:
FAILED

Lesson:
Memory decreased, but frame delivery remained degraded.

The next time a similar incident appears, Hindsight can retrieve this experience.

The investigation layer can then decide whether the current evidence really matches the old case.

This is why I don't think failed interventions should be treated as discarded attempts.

They are experiments.

The application produced a result.

The result changed what I know.

The memory system should preserve that.

I keep the retrieval mechanism explainable

A memory system is difficult to trust if it simply says, "I found something similar."

The project therefore defines an incident fingerprint containing concrete characteristics:

incident type
severity
FPS degradation
frame-time range
CPU spike
memory growth
jank rate
trigger/event
duration
application component

A fingerprint might look like:

{
  "incident_type": "FRAME_DROP",
  "fps_drop_percent": 61,
  "cpu_spike": true,
  "memory_spike": false,
  "duration_seconds": 5,
  "trigger": "screen_transition"
}

The initial similarity calculation can be explicit:

same incident type        +30
similar FPS degradation   +20
similar CPU behavior      +20
similar memory behavior   +10
same trigger              +20

I like this because the retrieval decision has a reason behind it.

If an engineer asks why an old experience appeared, I can explain that the incident type and trigger matched and that the CPU behavior was similar.

A score such as 82% is only a similarity score.

It is not a probability that the same fix will work.

That distinction prevents the memory system from creating false confidence.

Hindsight complements current evidence

There is another failure mode I wanted to avoid.

Suppose a previous incident was fixed successfully by moving computation away from the main thread.

A new incident also has high CPU.

It would be easy to retrieve the old experience and simply repeat the recommendation.

I don't want that.

The current incident might also have:

rapid memory growth
GC events
a different application trigger
different frame-time behavior

Those differences matter.

So the investigation context can include previous experiences alongside the current evidence:

CURRENT INCIDENT
...

PREVIOUS RELEVANT EXPERIENCES

Experience 1:
Incident:
...
Fix:
...
Outcome:
SUCCESS

Experience 2:
Incident:
...
Fix:
...
Outcome:
FAILED

TASK

Determine whether either experience is relevant.

Explain:
- similarities
- differences
- whether previous evidence should influence the current investigation
- what should be tested now

This makes Hindsight an input to reasoning rather than an answer generator.

That distinction is central to the design.

The rest of the architecture exists to make memory meaningful

Hindsight cannot compensate for bad telemetry.

If the runtime data is fake, memory simply preserves bad information.

If incident detection is wrong, the stored experiences inherit that mistake.

If verification is based on AI confidence rather than measurements, "successful" experiences become unreliable.

So the surrounding architecture has to establish a trustworthy chain first.

The telemetry layer collects real runtime evidence.

The incident detector uses deterministic thresholds.

The evidence correlator builds timelines.

The investigation engine produces structured hypotheses.

The verification engine compares before and after.

Only then does the experience become persistent context.

The repository describes this as a complete investigation loop, and I think that is the right abstraction.

The memory layer is not an add-on.

It is the final stage of the loop.

The AI gets structured evidence, not an entire application history

The investigation model receives a compact representation of the incident.

For example:

{
  "summary": "The incident is primarily associated with high CPU workload.",
  "hypotheses": [
    {
      "cause": "Main-thread computation",
      "support": [
        "CPU increased from 37% to 94%",
        "frame time increased during the CPU spike"
      ],
      "contradictions": [],
      "confidence_label": "supported"
    }
  ],
  "missing_evidence": [
    "Thread-level CPU attribution"
  ],
  "recommended_action": "Profile the main thread during the incident.",
  "verification_metric": "frame time and FPS"
}

Previous Hindsight experiences can be supplied as additional structured context.

This keeps the prompt focused.

The project deliberately avoids sending the entire raw telemetry history to the model.

Instead:

1000 raw samples
      ↓
Evidence processing
      ↓
20 meaningful facts
      ↓
Current incident + relevant experience
      ↓
Local LLM

This makes the model's job much more manageable.

It also makes the output easier to audit.

Verification determines whether memory deserves to exist

One of my favorite architectural boundaries in DevLens is the verification engine.

Suppose the system recommends a fix.

The developer applies it.

The workload runs again.

The comparison engine calculates:

FPS improvement
Frame-time reduction
CPU reduction
Memory change
Jank change

The outcome can be:

SUCCESS
PARTIAL
FAILED
WORSE
INCONCLUSIVE

That outcome is deterministic.

The LLM doesn't get to decide that a 1 FPS improvement is a success simply because it sounds positive.

The configured verification rules make that decision.

The resulting experience can then be stored.

This means Hindsight receives something that has already passed through measurement.

That's the part of the architecture that makes the memory useful.

The controlled workload matters more than I expected

The project uses a controlled target application with reproducible stress modes:

Normal Mode
CPU Stress
Memory Stress
Rendering Stress
Combined Incident
Recovery / Fixed Version

I made that choice because reproducibility is essential when storing verified experiences.

If I cannot reproduce the incident, I cannot reliably compare the before and after state.

A controlled workload gives me:

Known baseline
    ↓
Known incident
    ↓
Known intervention
    ↓
Known verification scenario

It also makes the system itself easier to test.

I can run the same workload repeatedly while changing one part of the implementation.

That is much closer to an experiment than a passive monitoring session.

I use Hindsight as engineering history

This is where Hindsight on GitHub fits the project most naturally.

I don't need memory for its own sake.

I need a durable record of engineering decisions and their consequences.

The distinction looks like this:

AI says:
"Memory pressure may be involved."


That is a hypothesis.

After testing:

Developer changes allocation behavior.

Memory:
610 MB → 590 MB

FPS:
24 → 25

Outcome:
FAILED

That is an experience.

The second record is more valuable because it contains a consequence.

The next investigation can use it.

What I learned

1. Memory should preserve outcomes

If I only remember what the model suggested, I'm storing opinions.

If I remember what happened after the developer acted, I'm storing experience.

2. Verification is the gate to durable knowledge

An untested recommendation should not have the same status as a measured intervention.

3. Failed fixes are part of the debugging history

A failed change narrows future investigation and prevents repeated blind experiments.

4. Retrieval needs an explanation

I want to know why an old experience was considered relevant.

Explicit fingerprints and similarity rules make that possible.

5. Historical context should never override current telemetry

The old incident is evidence.

The current incident is still the current incident.

That distinction keeps memory useful without turning it into a source of stale conclusions.

The resulting architecture is straightforward:

Target app
    ↓
Runtime telemetry
    ↓
Incident detection
    ↓
Evidence correlation
    ↓
AI investigation
    ↓
Developer action
    ↓
Verification
    ↓
Hindsight experience
    ↓
Similar experience retrieval
    ↓
Future investigation

The broader lesson I took from building this is that useful AI memory isn't necessarily about remembering more.

It's about remembering the right things.

For DevLens, the right things are the investigations that reached a measurable outcome: what happened, what I thought was causing it, what I changed, what the application did afterward, and what that result taught me.

That is why Hindsight became more than a persistence detail.

It became the mechanism that lets one debugging session influence the next without pretending that yesterday's answer is automatically today's answer.