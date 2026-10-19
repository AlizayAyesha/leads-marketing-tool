# Experiments

Record every significant AI change before it overwrites production prompts.

Required fields:

```text
experiment_id
date
agent
model
prompt_version
dataset
temperature / settings
input / output (pointers, not secrets)
evaluation
notes
```

| Folder | Use |
| --- | --- |
| `prompts/` | Versioned prompt snapshots |
| `evaluations/` | Metric definitions and scorecards |
| `datasets/` | Labeled fixtures (not production PII) |
| `results/` | Dated run outputs |

Do not claim an agent improved without a result file.
