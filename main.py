import os
import torch
from funasr import AutoModel

# 验证显卡驱动是否在 VS Code 内生效
print(f"正在启动 5070 引擎... 状态: {torch.cuda.is_available()}")

# 加载阿里云模型
model = AutoModel(model="daodaocici/speech_paraformer-tiny-zh-cn-16k-common-vocab8404-pytorch", device="cuda:0")

def start_recognize(sensor_id, audio_file):
    # 模拟你说的变量逻辑
    vocab_path = f"vocab_{sensor_id}.txt"
    if not os.path.exists(vocab_path):
        print(f"找不到指令集: {vocab_path}")
        return

    with open(vocab_path, "r", encoding="utf-8") as f:
        hotwords = [line.strip() for line in f.readlines() if line.strip()]
        hotwords_query = " ".join(hotwords)

    print(f"\n[变量 {sensor_id}] 正在检索列表: {hotwords}")

    # 推理
    if os.path.exists(audio_file):
        res = model.generate(input=audio_file, hotwords=hotwords_query)
        result_text = res[0]['preds'][0]
        
        # 逻辑判定：匹配列表内的 20 个句子
        if result_text in hotwords:
            print(f">>> 成功匹配指令: 【{result_text}】")
        else:
            print(f">>> 识别为: {result_text} (不在列表中，已忽略)")
    else:
        print(f"请准备音频文件: {audio_file}")

# --- 下面这行你可以手动修改变量 10 或 20 来测试 ---
# start_recognize(10, "test.wav")