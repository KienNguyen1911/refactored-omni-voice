using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace OmniVoice
{
    public class SplashScreenForm : Form
    {
        private Label lblTitle;
        private Label lblBadge;
        private Label lblSubtitle;
        public Label lblStatus;
        private Label lblFooter;
        private ProgressBar pBar;
        private Panel pnlAccent;

        public SplashScreenForm()
        {
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Size = new Size(520, 270);
            this.BackColor = Color.FromArgb(12, 14, 19);
            this.ShowInTaskbar = true;
            this.TopMost = true;

            // Accent strip at top
            pnlAccent = new Panel
            {
                Dock = DockStyle.Top,
                Height = 3,
                BackColor = Color.FromArgb(59, 130, 246) // Vibrant Blue
            };
            this.Controls.Add(pnlAccent);

            // Title
            lblTitle = new Label
            {
                Text = "OmniVoice Studio",
                Font = new Font("Segoe UI", 20, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(36, 36),
                AutoSize = true
            };
            this.Controls.Add(lblTitle);

            // Badge
            lblBadge = new Label
            {
                Text = "AI WORKSTATION",
                Font = new Font("Segoe UI", 7.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(96, 165, 250),
                BackColor = Color.FromArgb(30, 41, 59),
                Location = new Point(315, 46),
                Padding = new Padding(5, 2, 5, 2),
                AutoSize = true
            };
            this.Controls.Add(lblBadge);

            // Subtitle
            lblSubtitle = new Label
            {
                Text = "Trạm xử lý âm thanh AI chuyên nghiệp • Zero-Shot Voice Cloning",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(156, 163, 175),
                Location = new Point(37, 78),
                AutoSize = true
            };
            this.Controls.Add(lblSubtitle);

            // Animated ProgressBar (Marquee)
            pBar = new ProgressBar
            {
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 25,
                Location = new Point(38, 140),
                Size = new Size(444, 6)
            };
            this.Controls.Add(pBar);

            // Status message
            lblStatus = new Label
            {
                Text = "Đang khởi động hệ thống và nạp GPU CUDA...",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(226, 232, 240),
                Location = new Point(37, 160),
                Size = new Size(444, 24)
            };
            this.Controls.Add(lblStatus);

            // Footer note
            lblFooter = new Label
            {
                Text = "Ứng dụng đang khởi tạo trong nền. Cửa sổ làm việc sẽ tự động hiện lên...",
                Font = new Font("Segoe UI", 8.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(100, 116, 139),
                Location = new Point(37, 215),
                Size = new Size(444, 20)
            };
            this.Controls.Add(lblFooter);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            // Draw sleek subtle outer border
            using (Pen borderPen = new Pen(Color.FromArgb(40, 48, 65), 1))
            {
                e.Graphics.DrawRectangle(borderPen, 0, 0, this.Width - 1, this.Height - 1);
            }
        }

        public void UpdateStatus(string message)
        {
            if (this.InvokeRequired)
            {
                this.BeginInvoke(new Action(() => UpdateStatus(message)));
                return;
            }
            lblStatus.Text = message;
        }
    }

    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // 1. Mutex: Prevent user from accidentally spamming multiple instances
            bool isNewInstance;
            using (Mutex mutex = new Mutex(true, "OmniVoiceStudio_SingleInstance_Lock", out isNewInstance))
            {
                if (!isNewInstance)
                {
                    MessageBox.Show(
                        "OmniVoice Studio đang trong tiến trình khởi động hoặc đã mở sẵn trên máy tính.\n\nVui lòng đợi cửa sổ hiển thị trên màn hình!",
                        "OmniVoice Studio - Đang chạy",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information
                    );
                    return;
                }

                // 2. Locate installation directory
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string pythonPath = Path.Combine(baseDir, ".venv", "Scripts", "python.exe");

                if (!File.Exists(pythonPath))
                {
                    try
                    {
                        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\OmniVoiceStudio"))
                        {
                            if (key != null)
                            {
                                string savedPath = key.GetValue("InstallPath") as string;
                                if (!string.IsNullOrEmpty(savedPath))
                                {
                                    string testPy = Path.Combine(savedPath, ".venv", "Scripts", "python.exe");
                                    if (File.Exists(testPy))
                                    {
                                        baseDir = savedPath;
                                        pythonPath = testPy;
                                    }
                                }
                            }
                        }
                    }
                    catch { }
                }

                if (!File.Exists(pythonPath))
                {
                    string[] candidates = new string[]
                    {
                        @"C:\Dev\omni-voice\dist\OmniVoiceStudio",
                        @"C:\Dev\omni-voice"
                    };
                    foreach (var cand in candidates)
                    {
                        string testPy = Path.Combine(cand, ".venv", "Scripts", "python.exe");
                        if (File.Exists(testPy))
                        {
                            baseDir = cand;
                            pythonPath = testPy;
                            break;
                        }
                    }
                }

                if (!File.Exists(pythonPath))
                {
                    MessageBox.Show(
                        "Không tìm thấy môi trường Python tại:\n" + pythonPath + "\n\n" +
                        "LƯU Ý:\n" +
                        "Nếu bạn vừa copy file 'OmniVoiceStudio.exe' riêng lẻ ra Desktop, vui lòng đặt file trong thư mục ứng dụng cùng với thư mục .venv.",
                        "OmniVoice Studio - Lỗi",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning
                    );
                    return;
                }

                try
                {
                    using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\OmniVoiceStudio"))
                    {
                        if (key != null) key.SetValue("InstallPath", baseDir);
                    }
                }
                catch { }

                Directory.SetCurrentDirectory(baseDir);

                // Setup Environment
                Environment.SetEnvironmentVariable("PYTHONUNBUFFERED", "1");
                Environment.SetEnvironmentVariable("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True");

                string currentPath = Environment.GetEnvironmentVariable("PATH") ?? "";
                string[] possibleFfmpeg = new string[]
                {
                    Path.Combine(baseDir, "tools", "ffmpeg", "bin"),
                    @"C:\Dev\VoiceStudio",
                    Environment.ExpandEnvironmentVariables(@"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin"),
                    Environment.ExpandEnvironmentVariables(@"%LOCALAPPDATA%\Programs\node")
                };

                foreach (var dir in possibleFfmpeg)
                {
                    if (Directory.Exists(dir) && !currentPath.Contains(dir))
                    {
                        currentPath = dir + ";" + currentPath;
                    }
                }
                Environment.SetEnvironmentVariable("PATH", currentPath);

                // 3. Show Splash Screen immediately!
                SplashScreenForm splash = new SplashScreenForm();
                splash.Show();
                Application.DoEvents();

                // 4. Start Python process in background
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = pythonPath,
                    Arguments = "-m omnivoice.desktop",
                    WorkingDirectory = baseDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                Process pythonProcess = null;
                try
                {
                    pythonProcess = Process.Start(psi);
                }
                catch (Exception ex)
                {
                    splash.Close();
                    MessageBox.Show("Không thể khởi động Python backend: " + ex.Message, "Lỗi", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                // 5. Monitor startup in background thread and close splash when ready
                Thread monitorThread = new Thread(() =>
                {
                    splash.UpdateStatus("Đang nạp Backend API & Engine AI...");
                    bool isServerReady = false;
                    int attempts = 0;

                    while (attempts < 120) // max 60s
                    {
                        if (pythonProcess.HasExited)
                        {
                            break;
                        }

                        if (attempts == 4)
                        {
                            splash.UpdateStatus("Đang kiểm tra kết nối GPU CUDA & SQLite...");
                        }
                        else if (attempts == 8)
                        {
                            splash.UpdateStatus("Đang tải giao diện OmniVoice Studio...");
                        }

                        try
                        {
                            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:8000/api/health");
                            req.Timeout = 1000;
                            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                            {
                                if (resp.StatusCode == HttpStatusCode.OK)
                                {
                                    isServerReady = true;
                                    break;
                                }
                            }
                        }
                        catch { }

                        Thread.Sleep(500);
                        attempts++;
                    }

                    if (isServerReady)
                    {
                        splash.UpdateStatus("Khởi động thành công! Đang mở cửa sổ...");
                        Thread.Sleep(1200); // Give the Webview native window time to show up
                    }

                    // Close splash screen
                    try
                    {
                        splash.BeginInvoke(new Action(() => splash.Close()));
                    }
                    catch { }
                });
                monitorThread.IsBackground = true;
                monitorThread.Start();

                // Run message loop for splash screen
                Application.Run(splash);

                // Once splash closes, wait for python app to finish before releasing mutex
                if (pythonProcess != null && !pythonProcess.HasExited)
                {
                    pythonProcess.WaitForExit();
                }
            }
        }
    }
}
