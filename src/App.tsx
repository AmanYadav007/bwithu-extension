import Bear from "./Bear";
import { useEffect } from "react";

export default function App(){

  useEffect(()=>{

    const msg = new SpeechSynthesisUtterance(
      "Hi. I'm B. I'll stay with you while you browse."
    );

    msg.pitch=1.3;
    msg.rate=1;

    speechSynthesis.speak(msg);

  },[])

  return(
    <div
      style={{
        width:"100%",
        height:"100%",
        display:"flex",
        flexDirection:"column",
        justifyContent:"center",
        alignItems:"center",
        color:"white"
      }}
    >
      <Bear />

      <div style={{
        marginTop:30,
        padding:"16px 22px",
        borderRadius:20,
        background:"rgba(255,255,255,0.08)",
        backdropFilter:"blur(20px)"
      }}>
        Hi, I'm B ✨
      </div>
    </div>
  )
}
