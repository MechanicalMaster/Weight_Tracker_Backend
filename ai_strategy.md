# AI Observability & Evaluation Strategy

## 1. Observability: "What is happening right now?"

Observability goes beyond simple logging. It answers questions like *"Why did that request cost $0.05?"* or *"Why is the model hallucinating hot dogs as carrots?"*.

### A. The "Black Box" Recorder
We are currently logging inputs (Image Hash) and outputs (Parsed JSON). We need to enrich this.

**Action Items:**
1.  **Capture Token Usage**: Extract `response.usage` (prompt_tokens, completion_tokens) from OpenAI responses.
    *   *Why:* To calculate exact COGS (Cost of Goods Sold) per image analysis.
2.  **Trace ID Propagation**: Ensure a single `traceId` follows the request from the Client -> API -> Stage 1 -> Stage 2 -> Firestore.
3.  **Model Configuration Snapshot**: Store the exact params used (temperature, max_tokens, prompt_version) alongside the result. You are already doing this with `promptVersion`—excellent.

### B. The Feedback Loop (The "Golden Signal")
The most valuable signal is **User Correction**.
If the AI predicts "150g Chicken Breast" and the user changes it to "200g Steak", that is a high-quality training example.

**Implementation Approach:**
1.  **Link Analysis to Entry**: When the user saves a meal, pass the `FoodAnalysisRecord.id` that generated the data.
2.  **The "Act vs. Predict" Diff**: Trigger a background function on meal save:
    *   **Predicted**: { food: "Chicken", calories: 200 } (from `FoodAnalysisRecord`)
    *   **Actual**: { food: "Steak", calories: 450 } (from `MealLog`)
    *   **Metric**: Calculate `Error %` or `Semantic Distance`.
3.  **Flagging**: If `Error % > 50%`, flag the image for manual review (to be added to your Golden Dataset).

---

## 2. Evaluations (Evals): "Is it getting better?"

Never deploy a prompt change without running Evals. It protects you from regression (e.g., you fix "Pizza detection" but break "Salad detection").

### A. The "Golden Dataset"
You need a "Truth Set".

**Structure:**
*   Folder: `evals/dataset/`
*   Content:
    *   `pizza_01.jpg` -> `pizza_01.json` (Expected: "Pizza", ~300kcal)
    *   `salad_bowl.jpg` -> `salad_bowl.json` (Expected: "Mixed Greens", ~50kcal)
*   **Size**: Start with 20 diverse images. Aim for 50.

### B. Automated Eval Pipeline (CI/CD for AI)
Create a script (e.g., `npm run eval`) that:
1.  Iterates through your Golden Dataset.
2.  Runs your *current* `vision.ts` logic against each image.
3.  **Scores the result** against the `.json` truth file.

**Scoring Metrics:**
1.  **Hit Rate (Classification)**: Did it identify the "Pizza"? (Yes/No)
    *   *Implementation*: `string similarity` check or `LLM-as-a-Judge` ("Does 'Margherita Pie' mean 'Pizza'?").
2.  **MAE (Mean Absolute Error) for Calories**: `Abs(Predicted - Actual)`.
    *   *Goal*: Minimize this number across the dataset.

### C. LLM-as-a-Judge
Instead of writing complex Regex to compare "Steak" vs "Beef Steak", use a cheap LLM (gpt-4o-mini) to grade the response.

**Prompt for Judge:**
> "Ground truth is 'Grilled Chicken Salad'. Model predicted 'Chicken Caesar Salad'. On a scale of 0-1, how accurate is this? 1 = Correct, 0 = Wrong."

---

## 3. Implementation Roadmap

### Phase 1: Passive Observation (Low Effort)
- [ ] Update `vision.ts` to log token usage and costs.
- [ ] Add `parentAnalysisId` to your `FoodLog` schema to link saved meals back to AI predictions.

### Phase 2: dataset Accumulation
- [ ] Create a script to query Firestore for "High Correction" events (where user changed >50% of values).
- [ ] Download these images + user's "Actual" data to form your **Golden Dataset**.

### Phase 3: Automated Evals
- [ ] Write the `evals/run.ts` script.
- [ ] Run this script before every prompt edit.
