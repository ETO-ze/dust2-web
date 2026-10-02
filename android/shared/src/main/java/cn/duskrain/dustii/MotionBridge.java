package cn.duskrain.dustii;

import android.app.Activity;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.view.Surface;
import org.json.JSONArray;
import org.json.JSONObject;

/** Shared by both hosts. No gameplay state or targeting crosses this bridge. */
public final class MotionBridge implements SensorEventListener {
    public interface Sink { void send(JSONObject message); }
    private final Activity activity;
    private final SensorManager manager;
    private final Sensor sensor;
    private final HandlerThread thread = new HandlerThread("DustII-motion");
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Handler worker;
    private final JSONObject engine;
    private volatile boolean active;
    private Sink sink;
    private JSONObject latest;
    private long timestamp;
    private final double[] integrated = {0,0,0,1};
    private final Runnable flush = new Runnable() {
        @Override public void run() {
            if (!active) return;
            JSONObject message;
            synchronized (MotionBridge.this) { message=latest;latest=null; }
            if (message!=null && sink!=null) sink.send(message);
            main.postDelayed(this,17); // at most 59 bridge messages/s
        }
    };
    public MotionBridge(Activity activity, JSONObject engine) {
        this.activity=activity;this.engine=engine;
        manager=(SensorManager)activity.getSystemService(Activity.SENSOR_SERVICE);
        Sensor preferred=manager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR);
        sensor=preferred!=null?preferred:manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
        thread.start();worker=new Handler(thread.getLooper());
    }
    public boolean handle(JSONObject request, Sink reply) throws Exception {
        String type=request.optString("type");
        if (!type.equals("motionCapabilities")&&!type.equals("startMotion")&&!type.equals("stopMotion")&&!type.equals("calibrateMotion")) return false;
        JSONObject response=new JSONObject().put("type",type).put("requestId",request.opt("requestId"));
        if (type.equals("motionCapabilities")) {
            response.put("available",sensor!=null).put("engine",engine).put("sampleHz",100).put("bridgeMaxHz",60)
                .put("sensor",sensor==null?"none":sensor.getStringType());
        } else if (type.equals("stopMotion")) stop();
        else {
            stop();
            if (sensor==null) response.put("error","设备没有可用陀螺仪");
            else if (!activity.hasWindowFocus()) response.put("error","游戏未获得焦点");
            else {
                sink=reply;active=true;
                if (!manager.registerListener(this,sensor,10000,worker)) { stop();response.put("error","传感器启动失败"); }
                else main.postDelayed(flush,17);
            }
        }
        reply.send(response);return true;
    }
    public synchronized void stop() {
        active=false;manager.unregisterListener(this);main.removeCallbacks(flush);latest=null;sink=null;timestamp=0;
        integrated[0]=integrated[1]=integrated[2]=0;integrated[3]=1;
    }
    public void close() { stop();thread.quitSafely(); }
    @Override public synchronized void onSensorChanged(SensorEvent event) {
        if (!active) return;
        try {
            double[] q=new double[4];
            if (event.sensor.getType()==Sensor.TYPE_GAME_ROTATION_VECTOR) {
                float[] nativeQ=new float[4];SensorManager.getQuaternionFromVector(nativeQ,event.values);
                q[0]=nativeQ[1];q[1]=nativeQ[2];q[2]=nativeQ[3];q[3]=nativeQ[0];
            } else {
                double dt=timestamp==0?0:(event.timestamp-timestamp)*1e-9;
                if (dt>0 && dt<.2) {
                    double x=event.values[0],y=event.values[1],z=event.values[2],speed=Math.sqrt(x*x+y*y+z*z);
                    if (speed>1e-8 && speed<15) {
                        double a=speed*dt/2,s=Math.sin(a)/speed,dx=x*s,dy=y*s,dz=z*s,dw=Math.cos(a);
                        double ax=integrated[0],ay=integrated[1],az=integrated[2],aw=integrated[3];
                        integrated[0]=aw*dx+ax*dw+ay*dz-az*dy;integrated[1]=aw*dy-ax*dz+ay*dw+az*dx;
                        integrated[2]=aw*dz+ax*dy-ay*dx+az*dw;integrated[3]=aw*dw-ax*dx-ay*dy-az*dz;
                    }
                }
                System.arraycopy(integrated,0,q,0,4);
            }
            timestamp=event.timestamp;
            int rotation=activity.getWindowManager().getDefaultDisplay().getRotation();
            int degrees=rotation==Surface.ROTATION_90?90:rotation==Surface.ROTATION_180?180:rotation==Surface.ROTATION_270?270:0;
            latest=new JSONObject().put("type","motion").put("quaternion",new JSONArray(q)).put("time",event.timestamp/1e6).put("rotation",degrees);
        } catch (Exception ignored) { /* Invalid samples never become view input. */ }
    }
    @Override public void onAccuracyChanged(Sensor sensor,int accuracy) { }
}
