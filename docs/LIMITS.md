# Limits

The full list of SafeLabs Guard limits. Moved out of the [README](../README.md), which keeps the five most important.

* Only the PackProof packing demo (ORDER-1042: red mug, blue notebook, USB-C cable) has been tested.
* The benchmark is an offline replay of responses recorded once, with synthetic images and speech and small samples. Real-photo accuracy has not been measured, and live camera capture and microphone recording in a browser have not been verified.
* The guard trusts SAM and OCR. A frame where SAM wrongly finds every required item will pass, and a SAM miss or a false extra object stops the step (see the [benchmark results](../bench/RESULTS.md) for the false blocks). Once, on a live camera frame, the detector listed a red mug that was not in the frame; it was not reproduced.
* There is no freshness check. A frame replayed at a later step that still shows the right items looks the same as a fresh one.
* SAM is asked only about the step's items plus `banana` and `laptop` on the live route, so those are the only wrong objects checked. Extra-object coverage in the benchmark is thin: W03 (a banana beside all three items at the cable step) and W04 (a laptop beside the box at the seal step), and none at the first (mug) step, where the manual banana and laptop runs happened. Only W03 differed between guarded and unguarded; W04 was held by every agent.
* Injection detection is imperfect. OCR can miss or garble a sign, and a sign it does not read is not flagged. An injection sign that reads only a fragment (for example "IGNORE ALL", with no audio) was not flagged by the detector in one manual run; Spark held on its own.
* Voice is English only, and other languages are blocked as a safe default ("voice unavailable"). Voice is allowlist-based, limited to confirmations and item names, so benign phrases outside the allowlist are blocked (for example "ready to ship"). Silence is allowed: a turn with no voice clip, or a clip with no speech, is not treated as an instruction.
* Rate limits, the daily cap, the kill switch and shipments are in memory per server instance, not global. The shipment is simulated: no goods, payments or carriers are involved.
* **Spark does not read pixels.** SAM and OCR are the eyes. Muse Spark reasons over a text perception report built from their output.
* **Signs and spoken commands.** The guard flags them in both modes (in Unguarded mode as a shadow warning only); in Unguarded mode the agent runs whatever it proposes. In the recorded benchmark, the prompted agent without the guard held on its own in 26 of 27 attack cases (attack success 1/27), the guarded agent in all 27 (0/27), and the weak naive baseline was fooled in 13 of 27. So the guard adds detection, a hard stop and a per-turn decision record on top of a model that usually holds by itself.
* **SAM confidence.** A confidence of 1.00 shown for a live SAM detection is not a real confidence score. The API does not provide one.
* **Prompt labels.** The label `usb-c cable` is sent to SAM as the alias `usb cable`. The display name is unchanged.
