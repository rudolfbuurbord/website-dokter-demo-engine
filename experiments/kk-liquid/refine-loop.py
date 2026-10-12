"""Match the moving paint around the loop boundary with bidirectional optical flow.
Only the existing ring footage is used; no reversed playback or material replacement.
"""
from pathlib import Path
import cv2,numpy as np,subprocess,json
p=Path(__file__).parent/'kleur-karakter'
cap=cv2.VideoCapture(str(p/'ring-smooth.mp4'));frames=[]
while True:
 ok,f=cap.read()
 if not ok:break
 frames.append(f)
cap.release();overlap=24;h,w=frames[0].shape[:2]
grid=np.stack(np.meshgrid(np.arange(w,dtype=np.float32),np.arange(h,dtype=np.float32)),axis=-1)
out=list(frames[overlap:-overlap])
for i in range(overlap):
 a,b=frames[-overlap+i],frames[i];ga=cv2.cvtColor(a,cv2.COLOR_BGR2GRAY);gb=cv2.cvtColor(b,cv2.COLOR_BGR2GRAY)
 flow=cv2.calcOpticalFlowFarneback(ga,gb,None,.5,4,25,4,7,1.5,0)
 back=cv2.calcOpticalFlowFarneback(gb,ga,None,.5,4,25,4,7,1.5,0)
 t=i/(overlap-1);t=t*t*(3-2*t)
 wa=cv2.remap(a,grid-flow*t,None,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT)
 wb=cv2.remap(b,grid-back*(1-t),None,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT)
 out.append(cv2.addWeighted(wa,1-t,wb,t,0))
dest=p/'ring-continuous.mp4'
proc=subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','bgr24','-s',f'{w}x{h}','-r','24','-i','-','-an','-c:v','libx264','-pix_fmt','yuv420p','-crf','19','-preset','fast','-movflags','+faststart',str(dest)],stdin=subprocess.PIPE)
for f in out:proc.stdin.write(f.tobytes())
proc.stdin.close();assert proc.wait()==0
a=np.array([cv2.resize(f,(192,108)).astype(float) for f in out]);d=np.abs(np.diff(a,axis=0)).mean((1,2,3));seam=float(np.abs(a[0]-a[-1]).mean())
print(json.dumps({'frames':len(out),'seconds':len(out)/24,'bytes':dest.stat().st_size,'medianFrameDelta':float(np.median(d)),'maxFrameDelta':float(max(d)),'loopBoundaryDelta':seam}))
