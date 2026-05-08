import { motion } from "framer-motion";
import { bearPixels } from "./pixelBear";

const colors:any = {
  1:"#A855F7",
  2:"#C084FC",
  3:"#E9D5FF"
};

export default function Bear() {
  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0.1}
      initial={{ y: -300, scale: 0.5 }}
      animate={{
        y: 0,
        scale: 1
      }}
      transition={{
        type: "spring",
        stiffness: 120
      }}
      style={{
        display:"grid",
        gridTemplateColumns:`repeat(10,16px)`,
        gap:2,
        cursor: "grab"
      }}
      whileDrag={{ cursor: "grabbing" }}
    >
      {bearPixels.join("").split("").map((p,i)=>(
        <motion.div
          key={i}
          animate={{
            y:[0,-2,0]
          }}
          transition={{
            repeat:Infinity,
            duration:2,
            delay:i*0.01
          }}
          style={{
            width:16,
            height:16,
            background:
              p==="0" ? "transparent" : colors[p],
            borderRadius:4
          }}
        />
      ))}
    </motion.div>
  )
}
