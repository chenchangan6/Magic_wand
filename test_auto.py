import os
import requests
from funasr import AutoModel

# ---------------------------------------------------------
# 第一部分：准备测试用的音频文件
# ---------------------------------------------------------
def download_test_audio(target_path):
    url = "https://isv-data.oss-cn-hangzhou.aliyuncs.com/ics/MaaS/ASR/test_audio/asr_example_zh.wav"
    if not os.path.exists(target_path):
        print(">>> 正在从云端下载标准测试音频...")
        try:
            r = requests.get(url, timeout=10)
            with open(target_path, 'wb') as f:
                f.write(r.content)
            print(">>> 下载完成。")
        except Exception as e:
            print(f">>> 下载音频失败: {e}")
    else:
        print(">>> 本地已存在测试音频。")

# ---------------------------------------------------------
# 第二部分：创建指令集
# ---------------------------------------------------------
def prepare_vocabs():
    with open("vocab_10.txt", "w", encoding="utf-8") as f:
        f.write("欢迎使用\n阿里云\n魔法实验室\n语音识别模型")
    print(">>> 已自动创建测试指令集: vocab_10.txt")

# ---------------------------------------------------------
# 第三部分：核心点火逻辑
# ---------------------------------------------------------
def run_test():
    audio_file = "test_demo.wav"
    download_test_audio(audio_file)
    prepare_vocabs()

    print("\n>>> 正在初始化 5070 算力引擎...")
    
    try:
        model = AutoModel(
            model="iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch", 
            device="cuda:0",
            disable_update=True
        )

        sensor_id = 10
        with open(f"vocab_{sensor_id}.txt", "r", encoding="utf-8") as f:
            hotwords_list = [line.strip() for line in f.readlines() if line.strip()]
            hotwords_str = " ".join(hotwords_list)

        print(f">>> 传感器 {sensor_id} 激活 | 仅搜索范围: {hotwords_list}")

        # 5070 显卡执行识别
        res = model.generate(input=audio_file, hotwords=hotwords_str)
        
        # 兼容不同模型版本的返回字段（安全读取，不会再报 'preds' 错误）
        if 'text' in res[0]:
            raw_result = res[0]['text']
        elif 'preds' in res[0]:
            raw_result = res[0]['preds'][0]
        else:
            raw_result = str(res[0])
            
        print(f"\nAI 原始识别结果: {raw_result}")
        
        # 逻辑匹配判定
        match = [cmd for cmd in hotwords_list if cmd in raw_result]
        if match:
            print(f"🔥 逻辑匹配成功: 命中了列表中的 {match} -> 执行动作！")
        else:
            print(f"❄️ 匹配失败 -> 已忽略。")

    except Exception as e:
        print(f"\n❌ 运行出错! 错误信息如下:\n{e}")

if __name__ == "__main__":
    run_test()