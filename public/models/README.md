# Vehicle Detection Model

The app serves the lightweight YOLO nano ONNX model from:

```text
public/models/yolov8n.onnx
```

The browser detector expects a YOLOv8-style COCO model exported to ONNX with RGB input shaped like `[1,3,640,640]` and output shaped like `[1,84,8400]`, `[1,8400,84]`, or an NMS-style `[1,N,6]`.

Vehicle classes are read from COCO class IDs:

- `2`: car
- `3`: motorcycle
- `5`: bus
- `7`: truck

You can override the path at deploy time with:

```text
NEXT_PUBLIC_YOLO_MODEL_URL=/models/your-model.onnx
```

PyTorch `.pt` checkpoints are useful for export/retraining, but the browser runtime does not use them. They are ignored by git to avoid deploying unused model artifacts.
