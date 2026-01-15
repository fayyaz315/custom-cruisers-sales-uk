const {CustomAPIError} = require('../errors/custom-error')
const errorHandlerMiddlerware = (err, req, res, next) =>{
    if ( err instanceof CustomAPIError){
        return res.status(err.status).json({msg : err.message})
    }
    return res.status(500).json({msg : 'Something went wrong......', err})
}

module.exports = errorHandlerMiddlerware