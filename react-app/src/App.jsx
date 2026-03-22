import { useEffect, useState, useRef } from "react";
import "./App.css";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import * as tf from "@tensorflow/tfjs";

const CROPS = ["Rice 🌾", "Wheat 🌾", "Tomato 🍅", "Potato 🥔", "Maize 🌽", "Cotton 🌱"];
const TASKS = ["Sowing 🌱", "Seedling 🌿", "Watering 💧", "Fertilizer 🌱", "Pesticide 🛡️", "Harvest 🏆"];

const CLASSES = ["Healthy", "Rust", "Blight", "Wilt"];

const DISEASES = {
  healthy: { treatment: "No treatment needed ✅", confidence: 95 },
  rust: { treatment: "Copper Oxychloride spray every 10 days", confidence: 87 },
  blight: { treatment: "Mancozeb + Metalaxyl spray", confidence: 92 },
  wilt: { treatment: "Soil solarization + Trichoderma", confidence: 89 },
};

const predictGrowthData = (crop) => {
  if (!crop.sowingDate) {
    const sowingTask = crop.tasks?.find(
      (t) => t.name.includes("Sowing") || t.name.includes("Seedling")
    );
    if (sowingTask) crop.sowingDate = sowingTask.dateTime.split("T")[0];
  }
  if (!crop.sowingDate) return [];

  const sow = new Date(crop.sowingDate);
  const today = new Date();
  const days = Math.max(
    Math.floor((today - sow) / (1000 * 60 * 60 * 24)) + 10,
    60
  );

  let data = [];
  let harvestDone = false;

  for (let i = 0; i <= days; i++) {
    const d = new Date(sow);
    d.setDate(d.getDate() + i);

    let growth = i * 1.5;

    if (crop.tasks) {
      crop.tasks.forEach((t) => {
        const taskDate = new Date(t.dateTime);
        if (taskDate <= d) {
          if (t.name.includes("Watering")) growth += 3;
          if (t.name.includes("Fertilizer")) growth += 6;
          if (t.name.includes("Pesticide")) growth += 2;
          if (t.name.includes("Harvest")) {
            growth = 100;
            harvestDone = true;
          }
        }
      });
    }

    growth = Math.min(growth, 100);

    data.push({
      date: d.toLocaleDateString(),
      growth,
      harvestDone,
    });
  }

  return data;
};

const getStage = (g) => {
  if (g < 25) return "Seedling 🌱";
  if (g < 50) return "Vegetative 🌿";
  if (g < 75) return "Flowering 🌼";
  if (g < 95) return "Ripening 🌾";
  return "Harvest Ready 🏆";
};

const getSoilType = (location) => {
  const soils = {
    Delhi: "Alluvial",
    Mumbai: "Coastal",
    Bangalore: "Red",
    Pune: "Black",
    Chennai: "Laterite",
  };
  return soils[location] || "Loamy";
};

export default function App() {
  const [active, setActive] = useState("home");
  const [selectedCrop, setSelectedCrop] = useState("");
  const [acres, setAcres] = useState("");
  const [cropStep, setCropStep] = useState(false);
  const [selectedTask, setSelectedTask] = useState("");
  const [taskDateTime, setTaskDateTime] = useState("");
  const [activities, setActivities] = useState([]);
  const [monthlyTasks, setMonthlyTasks] = useState([]);
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("Detecting...");
  const [currentWeather, setCurrentWeather] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [soilType, setSoilType] = useState("Loamy");
  const [ndvi, setNdvi] = useState(75);
  const [diseaseResult, setDiseaseResult] = useState(null);

  const fileInputRef = useRef(null);
  const imgRef = useRef(null);
  const [tmModel, setTmModel] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem("activities");
    const savedMonthly = localStorage.getItem("monthlyTasks");
    if (saved) setActivities(JSON.parse(saved));
    if (savedMonthly) setMonthlyTasks(JSON.parse(savedMonthly));
  }, []);

  useEffect(() => {
    const interval = setInterval(
      () => setTime(new Date().toLocaleString()),
      1000
    );
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const API = "0c842947a6fd69fce9cdd150247b8360";
        try {
          const res1 = await fetch(
            `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${API}&units=metric`
          );
          const cur = await res1.json();
          setCurrentWeather(cur);
          setLocation(cur.name);
          setSoilType(getSoilType(cur.name));
          setNdvi(Math.floor(Math.random() * 30) + 65);

          const res2 = await fetch(
            `https://api.openweathermap.org/data/2.5/forecast?lat=${latitude}&lon=${longitude}&appid=${API}&units=metric`
          );
          const fc = await res2.json();
          setForecast(fc.list.slice(0, 16));
        } catch (err) {
          console.error(err);
        }
      },
      () => {
        setLocation("Demo");
        setSoilType("Loamy");
      }
    );
  }, []);

  useEffect(() => {
    const loadModel = async () => {
      try {
        const m = await tf.loadLayersModel("/model/model.json");
        setTmModel(m);
      } catch (e) {
        console.error("Model load error", e);
      }
    };
    loadModel();
  }, []);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!tmModel) {
      alert("Model is loading, please try again in a few seconds.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (!imgRef.current) return;
      imgRef.current.src = reader.result;

      imgRef.current.onload = async () => {
        const tensor = tf.browser
          .fromPixels(imgRef.current)
          .resizeBilinear([224, 224])
          .toFloat()
          .div(255)
          .expandDims(0);

        const preds = tmModel.predict(tensor);
        const data = await preds.data();
        const maxIdx = data.indexOf(Math.max(...data));
        const label = CLASSES[maxIdx];
        const confidence = Math.round(data[maxIdx] * 100);

        setDiseaseResult({
          name: label,
          confidence,
          treatment:
            DISEASES[label.toLowerCase()]?.treatment ||
            "Consult agriculture expert",
        });
      };
    };
    reader.readAsDataURL(file);
  };

  const shareWhatsApp = () => {
    const message = `🌾 Farmer App\nCrops: ${activities.length}\nNDVI: ${ndvi}%\nLocation: ${location}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  };

  const saveTask = () => {
    if (!selectedCrop || !acres || !selectedTask || !taskDateTime) {
      alert("Enter all fields");
      return;
    }

    const sowingDate = taskDateTime.split("T")[0];
    const timeStr = new Date(taskDateTime).toLocaleTimeString();
    const cropIndex = activities.findIndex((a) => a.crop === selectedCrop);

    let updated;
    if (cropIndex !== -1) {
      updated = [...activities];
      updated[cropIndex].tasks.push({
        name: selectedTask,
        dateTime: taskDateTime,
        completed: false,
        time: timeStr,
      });
      updated[cropIndex].sowingDate =
        updated[cropIndex].sowingDate || sowingDate;
      updated[cropIndex].acres = acres;
    } else {
      const newCrop = {
        id: Date.now(),
        crop: selectedCrop,
        sowingDate,
        acres,
        tasks: [
          {
            name: selectedTask,
            dateTime: taskDateTime,
            completed: false,
            time: timeStr,
          },
        ],
      };
      updated = [...activities, newCrop];
    }

    setActivities(updated);
    localStorage.setItem("activities", JSON.stringify(updated));

    setSelectedCrop("");
    setAcres("");
    setSelectedTask("");
    setTaskDateTime("");
    setCropStep(false);
    setActive("home");
  };

  const dueTasks = [];
  activities.forEach((crop) => {
    (crop.tasks || []).forEach((task) => {
      if (!task.dateTime) return;
      const t = new Date(task.dateTime);
      if (Number.isNaN(t.getTime())) return;

      const now = new Date();
      if (!task.completed && t <= now) {
        dueTasks.push({ ...task, cropName: crop.crop, cropId: crop.id });
      }
    });
  });

  const markDone = (cropId, taskTime) => {
    const updatedActivities = activities.map((crop) => {
      if (crop.id === cropId) {
        return {
          ...crop,
          tasks: crop.tasks.map((t) =>
            t.dateTime === taskTime ? { ...t, completed: true } : t
          ),
        };
      }
      return crop;
    });
    setActivities(updatedActivities);
    localStorage.setItem("activities", JSON.stringify(updatedActivities));

    const crop = activities.find((c) => c.id === cropId);
    if (crop) {
      const task = crop.tasks.find((t) => t.dateTime === taskTime);
      const newMonthly = {
        id: Date.now(),
        crop: crop.crop,
        acres: crop.acres,
        task: task.name,
        dateTime: new Date().toISOString(),
        time: new Date().toLocaleTimeString(),
        weather: currentWeather?.weather?.[0]?.description || "Unknown",
        temp: currentWeather?.main?.temp || 0,
      };
      const updatedMonthly = [...monthlyTasks, newMonthly];
      setMonthlyTasks(updatedMonthly);
      localStorage.setItem("monthlyTasks", JSON.stringify(updatedMonthly));
    }
  };

  return (
    <div className="page">
      <div className="card">
        <div className="header">
          <h1>🌾 Farmer App</h1>
          <div className="status-bar">
            <span>🕐 {time}</span>
            <span>
              📍 {location} | 🟤 {soilType} | 🌍 NDVI: <strong>{ndvi}%</strong>
            </span>
          </div>
        </div>

        {active === "home" && (
          <>
            <div className="grid">
              <div className="box" onClick={() => setActive("task")}>
                📝 Task
              </div>
              <div className="box" onClick={() => setActive("growth")}>
                📊 Growth
              </div>
              <div className="box" onClick={() => setActive("weather")}>
                🌦 Weather
              </div>
              <div className="box" onClick={() => setActive("disease")}>
                🩺 Disease
              </div>
              <div className="box" onClick={() => setActive("reminder")}>
                🔔 Reminders ({dueTasks.length})
              </div>
              <div className="box" onClick={() => setActive("monthly")}>
                📅 Monthly ({monthlyTasks.length})
              </div>
            </div>
          </>
        )}

        {active === "task" && (
          <>
            {!cropStep ? (
              <>
                <h3>🌾 Select Crop</h3>
                <div className="select-grid">
                  {CROPS.map((crop) => (
                    <button
                      key={crop}
                      className={`crop-btn ${
                        selectedCrop === crop ? "active" : ""
                      }`}
                      onClick={() => setSelectedCrop(crop)}
                    >
                      {crop}
                    </button>
                  ))}
                </div>
                {selectedCrop && (
                  <>
                    <input
                      type="number"
                      placeholder="Acres"
                      step="0.1"
                      value={acres}
                      onChange={(e) => setAcres(e.target.value)}
                    />
                    <button
                      onClick={() => {
                        if (!acres) return alert("Enter acres");
                        setCropStep(true);
                      }}
                    >
                      Next ➡
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <h3>{selectedCrop}</h3>
                <div className="select-grid">
                  {TASKS.map((task) => (
                    <button
                      key={task}
                      className={`task-btn ${
                        selectedTask === task ? "active" : ""
                      }`}
                      onClick={() => setSelectedTask(task)}
                    >
                      {task}
                    </button>
                  ))}
                </div>
                {selectedTask && (
                  <>
                    <input
                      type="datetime-local"
                      value={taskDateTime}
                      onChange={(e) => setTaskDateTime(e.target.value)}
                    />
                    <button onClick={saveTask}>✅ Save</button>
                  </>
                )}
              </>
            )}
            <button className="back-btn" onClick={() => setActive("home")}>
              ⬅ Back
            </button>
          </>
        )}

        {active === "growth" && (
          <>
            <h2>📊 Growth Analytics</h2>
            {activities.length === 0 ? (
              <p className="no-growth">Add crop first!</p>
            ) : (
              activities.map((crop) => {
                const data = predictGrowthData(crop);
                if (!data.length)
                  return (
                    <div key={crop.id} className="growth-section">
                      <div className="crop-header">
                        <h3>
                          {crop.crop} ({crop.acres} acres)
                        </h3>
                      </div>
                      <p className="no-growth">Add Sowing first</p>
                    </div>
                  );

                const last = data[data.length - 1];
                const harvestTask = crop.tasks?.find((t) =>
                  t.name.includes("Harvest")
                );
                const isHarvested = harvestTask && last.harvestDone;

                return (
                  <div key={crop.id} className="growth-section">
                    <div className="crop-header">
                      <h3>
                        {crop.crop} ({crop.acres} acres)
                      </h3>
                      {isHarvested && (
                        <span className="harvest-badge">🏆 HARVESTED</span>
                      )}
                    </div>

                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={data}>
                        <CartesianGrid stroke="#e0e0e0" />
                        <XAxis dataKey="date" />
                        <YAxis domain={[0, 100]} />
                        <Tooltip />
                        <Line
                          type="monotone"
                          dataKey="growth"
                          stroke="#16a34a"
                          strokeWidth={4}
                          strokeDasharray={isHarvested ? "10 5" : "0"}
                        />
                      </LineChart>
                    </ResponsiveContainer>

                    <div className="growth-footer">
                      <p>
                        Current: <strong>{last.growth.toFixed(1)}%</strong>
                      </p>
                      <p>
                        Stage: <strong>{getStage(last.growth)}</strong>
                      </p>
                    </div>

                    <div className="task-history">
                      <h4>📋 Task History:</h4>
                      {crop.tasks?.map((t, i) => (
                        <div
                          key={i}
                          className={`task-item ${
                            t.completed ? "completed" : ""
                          }`}
                        >
                          <div className="task-info">
                            <span className="task-name">{t.name}</span>
                            <span className="task-date">
                              {new Date(t.dateTime).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="task-time-status">
                            <span className="task-time">{t.time}</span>
                            {t.completed && <span className="done">✔</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
            <button className="back-btn" onClick={() => setActive("home")}>
              ⬅ Back
            </button>
          </>
        )}

        {active === "weather" && (
          <>
            <h2>🌦 Weather Forecast</h2>
            <div className="weather-current">
              <div className="location">📍 {location}</div>
              <div className="soil">🟤 {soilType}</div>
              <div className="temp">
                🌡 {currentWeather?.main?.temp?.toFixed(1) ?? "--"}°C
              </div>
              <div className="details">
                <span>💧 {currentWeather?.main?.humidity ?? "--"}%</span>
                <span>💨 {currentWeather?.wind?.speed ?? "--"} m/s</span>
              </div>
            </div>

            <h3>📈 Next 2 Days Forecast</h3>
            {forecast.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart
                  data={forecast.map((f) => ({
                    time: `${f.dt_txt.slice(5, 10)} ${f.dt_txt.slice(11, 16)}`,
                    temp: Math.round(f.main.temp),
                    rain: f.rain?.["3h"] || 0,
                  }))}
                >
                  <CartesianGrid stroke="#e0e0e0" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="time"
                    height={80}
                    angle={-45}
                    textAnchor="end"
                    fontSize={12}
                  />
                  <YAxis yAxisId="left" stroke="#2563eb" />
                  <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" />
                  <Tooltip />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="temp"
                    stroke="#2563eb"
                    strokeWidth={4}
                    name="Temp (°C)"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="rain"
                    stroke="#f59e0b"
                    strokeWidth={3}
                    name="Rain (mm)"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="no-growth">Loading forecast...</p>
            )}

            <button className="back-btn" onClick={() => setActive("home")}>
              ⬅ Back
            </button>
          </>
        )}

        {active === "reminder" && (
          <>
            <h2>🔔 Reminders ({dueTasks.length})</h2>
            {dueTasks.length === 0 ? (
              <p className="no-growth">✅ No pending tasks</p>
            ) : (
              dueTasks.map((task, i) => (
                <div key={i} className="reminder-item">
                  <div>
                    <strong>{task.cropName}</strong>
                  </div>
                  <div>{task.name}</div>
                  <div>{new Date(task.dateTime).toLocaleString()}</div>
                  <button
                    onClick={() => markDone(task.cropId, task.dateTime)}
                  >
                    ✔ Done
                  </button>
                </div>
              ))
            )}
            <button className="back-btn" onClick={() => setActive("home")}>
              ⬅ Back
            </button>
          </>
        )}

        {active === "monthly" && (
          <>
            <h2>📅 Monthly Tasks ({monthlyTasks.length})</h2>
            {monthlyTasks.length === 0 ? (
              <p className="no-growth">No completed tasks yet</p>
            ) : (
              monthlyTasks.map((task, i) => (
                <div key={i} className="monthly-item">
                  <div>
                    <strong>{task.crop}</strong> ({task.acres} acres)
                  </div>
                  <div>
                    {task.task} - {task.time}
                  </div>
                  <div>
                    {new Date(task.dateTime).toLocaleDateString()}
                  </div>
                  <div>
                    🌤 {task.weather} | {task.temp}°C
                  </div>
                </div>
              ))
            )}
            <button className="back-btn" onClick={() => setActive("home")}>
              ⬅ Back
            </button>
          </>
        )}

        {active === "disease" && (
          <>
            <h2>🩺 Disease Scanner (ML)</h2>
            <div className="disease-scanner">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
              />
              <button onClick={() => fileInputRef.current?.click()}>
                📸 Upload Leaf Photo
              </button>

              <img ref={imgRef} alt="" className="preview-img" />

              {diseaseResult && (
                <div className="ai-result">
                  <h3>{diseaseResult.name}</h3>
                  <p>Confidence: {diseaseResult.confidence}%</p>
                  <p>Treatment: {diseaseResult.treatment}</p>
                </div>
              )}
            </div>
            <button onClick={shareWhatsApp}>📱 WhatsApp Share</button>
            <button className="back-btn" onClick={() => setActive("home")}>
              ⬅ Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
