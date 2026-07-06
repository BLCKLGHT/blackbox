# Vehicle Detection Model

Place a lightweight YOLO nano ONNX model here as:

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
