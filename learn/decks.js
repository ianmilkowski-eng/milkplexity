/* Milkplexity Learn · decks.js
   Demo study sets for the prototype. Terms come from the same public source
   material the app's concept maps cite (Google ML, AWS annotation, NIST
   statistics); the wording here is written for practice. In the app these
   are the owner's own cards from the private ledger. */
"use strict";
window.LearnDecks = [
  {id: "numbers", name: "Numbers in decisions", glyph: "%", hue: 190, cards: [
    ["Rate", "An event count compared with the opportunities for it to occur."],
    ["Base rate", "How common an outcome is overall, which changes what a headline accuracy figure means."],
    ["Precision", "Of the cases flagged positive, the fraction that really are positive."],
    ["Recall", "Of the actual positive cases, the fraction that were found."],
    ["Sample", "The observed subset of the group you actually want to describe."],
    ["Confidence interval", "A range from a sampling procedure meant to cover the true value at a stated long-run rate."],
    ["Comparison design", "Stating the objective, the outcome and the design before interpreting an experiment."],
    ["Random assignment", "Using chance to assign a treatment so its effect separates from group differences."],
  ]},
  {id: "annotation", name: "AI data and annotation", glyph: "A", hue: 205, cards: [
    ["Annotation", "One worker's response on one item."],
    ["Label", "The result produced from several annotations by a consolidation step."],
    ["Consolidation", "Combining several annotations into one result with a stated rule."],
    ["Agreement", "How closely workers' annotations match, which sets confidence in the label."],
    ["Verification", "Asking a reviewer to judge an existing label's quality, not to redo it."],
    ["Adjustment", "Correcting an existing annotation while keeping the original on record."],
    ["Bounding box", "An annotation marking an object's location; review checks its boundary and label."],
    ["Label lineage", "The traceable chain from the source item through prior labels to the latest review."],
  ]},
  {id: "ml", name: "ML in plain English", glyph: "f", hue: 175, cards: [
    ["Feature", "An input the model uses to make a prediction."],
    ["Target", "The output a supervised model is trained to predict."],
    ["Regression", "Predicting a number."],
    ["Classification", "Predicting a category."],
    ["Training", "Fitting a model to labeled examples so it can make predictions."],
    ["Validation set", "Data used to compare or tune models during development."],
    ["Test set", "Held-out examples that check a finished model on data it never saw."],
    ["Generalization", "How a model performs on new examples beyond those used to fit it."],
  ]},
];
