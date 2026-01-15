const tasksDOM = document.querySelector('.tasks')
const loadingDOM = document.querySelector('.loading-text')
const formDOM = document.querySelector('.task-form')
const taskInputDOM = document.querySelector('.task-input')
const formAlertDOM = document.querySelector('.form-alert')
// Load tasks from /api/orders
const showTasks = async () => {
  loadingDOM.style.visibility = 'visible'
  try {
    const {
      data: { orders },
    } = await axios.get('/webhook/orders/brg')
    if (orders.length < 1) {
      tasksDOM.innerHTML = '<h5 class="empty-list">No orders in your list</h5>'
      loadingDOM.style.visibility = 'hidden'
      return
    }
    const allTasks = orders
      .map((task) => {
        const { name, id } = task
        return `<div class="single-task">
<h5><span><i class="far fa-check-circle"></i></span>${name}</h5>
<div class="task-links">
  <button type="button" data-id="${id}" class="btn success-button submit-btn delete-btn">
        Post  
</button>
</div>
</div>`
      })
      .join('')
    tasksDOM.innerHTML = allTasks
  } catch (error) {
    tasksDOM.innerHTML =
      '<h5 class="empty-list">There was an error, please try later....</h5>'
  }
  loadingDOM.style.visibility = 'hidden'
}

showTasks()

// delete task /api/orders/:id

tasksDOM.addEventListener('click', async (e) => {
  const el = e.target
  if (el.parentElement.classList.contains('delete-btn')) {
    loadingDOM.style.visibility = 'visible'
    const id = el.parentElement.dataset.id
    const postData = {
        "admin_graphql_api_id": `${id}`
    }
    try {
      await axios.post('/webhook/orders/brg', postData);
      showTasks()
    } catch (error) {
      console.log(error)
    }
  }
  loadingDOM.style.visibility = 'hidden'
})

// form

formDOM.addEventListener('submit', async (e) => {
  e.preventDefault()
  const name = taskInputDOM.value

  try {
    await axios.post('/webhook/orders/brg', { admin_graphql_api_id: name })
    showTasks()
    taskInputDOM.value = ''
    formAlertDOM.style.display = 'block'
    formAlertDOM.textContent = `success, task added`
    formAlertDOM.classList.add('text-success')
  } catch (error) {
    formAlertDOM.style.display = 'block'
    formAlertDOM.innerHTML = `error, please try again`
  }
  setTimeout(() => {
    formAlertDOM.style.display = 'none'
    formAlertDOM.classList.remove('text-success')
  }, 3000)
})
