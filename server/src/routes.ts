import dayjs from "dayjs"
import { FastifyInstance } from "fastify"
import { request } from "http"
import {z} from 'zod'
import { prisma } from "./lib/Prisma"

export async function appRoutes(app:FastifyInstance){
  
  app.post('/habits',async (request)=> {

    //o zod faz a validacao do body
    const createHabitBody = z.object({
      title: z.string(),
      weekDays: z.array(
        z.number().min(0).max(6)
      )
    })


    const {title, weekDays} = createHabitBody.parse(request.body)

     //vai zerar a hora quando gerar a data do dia: '2023-01-10 00:00:00'
    const today = dayjs().startOf('day').toDate()

    await prisma.habit.create({
      data: {
        title,
        created_at: today,
        weekDays:{
          create: weekDays.map(weekDay => {
            return {
              week_day: weekDay,
            }
          })
        }
      }
    })
   
  })

  app.get('/day', async (request) => {
    const getDayParams = z.object({
      date: z.coerce.date() //converte a data q chega em string em date
    })

    const {date} = getDayParams.parse(request.query)

    const parsedDate = dayjs(date).startOf('day')
    const weekDay = parsedDate.get('day')

    const possibleHabits = await prisma.habit.findMany({
      where: {
        created_at: {
          lte: date //a data de criação é menor ou igual a data atual
        },
        weekDays: {
          some: {
            week_day: weekDay //onde pelo menor um for igual
          }
        }
      }
    })

    const day = await  prisma.day.findUnique({
      where: {
        date: parsedDate.toDate()
      },
      include: {
        dayHabits: true
      }
    })

    const completedHabits = day?.dayHabits.map(dayHabit => {
      return dayHabit.habit_id
    }) ?? []

    return {
      possibleHabits,
      completedHabits,
    }

 
  })

  app.patch('/habits/:id/toggle', async (request) => {
    const toggleHabitParams = z.object({
      id: z.string().uuid() //verifica se ta no formato uuid
    })

    const { id } = toggleHabitParams.parse(request.params)

    const today = dayjs().startOf('day').toDate()

    let day = await prisma.day.findUnique({
      where: {
        date: today
      }
    })

    if(!day){
      day = await prisma.day.create({
        data: {
          date: today
        }
      })
    }

    const dayHabit = await prisma.dayHabit.findUnique({
      where: {
        day_id_habit_id: {
          day_id: day.id,
          habit_id: id
        } 
      }
    })
    
    if(dayHabit){
      //remover a marcacao de completo
      await prisma.dayHabit.delete({
        where: {
          id: dayHabit.id 
        }
      })
    }else {
      //completar o habito
      await prisma.dayHabit.create({
        data: {
          day_id: day.id,
          habit_id: id
        }
      })
    }

  })

  app.get('/summary', async () => {
    //os seguintes comandos so funcionam no sqlite

    const summary = await prisma.$queryRaw`
      SELECT
       D.id, 
       D.date,
       (
        SELECT 
          cast(count(*) as float)
        FROM day_habits DH
        WHERE DH.day_id = D.id
       ) as completed,
       (
        SELECT
        cast(count(*) as float)
        FROM habit_week_days HDW
        JOIN habits H
          ON H.id = HDW.habit_id
        WHERE
          HDW.week_day = cast(strftime('%w', D.date/1000.0, 'unixepoch') as int)
          AND H.created_at <= D.date
       )as amount
       
      FROM days D
    `

    

    return summary
  })
}


