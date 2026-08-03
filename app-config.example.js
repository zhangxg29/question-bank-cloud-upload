window.APP_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  bucket: "question-files",
  useAnonymousAuth: false,
  // AI 解析接口已停用，保持空字符串即可。
  aiAnalysisEndpoint: "",
  // 内部手机号-姓名对照表（手机号登录后自动显示姓名）
  phoneDirectory: {
    "13800000000": "示例姓名",
  },
};
